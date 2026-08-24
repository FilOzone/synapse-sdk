import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { ValidationError } from '../errors/base.ts'
import { AddPiecesFlushError } from '../errors/pdp.ts'
import { PullError } from '../errors/pull.ts'
import { DataSetNotFoundError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { randU256 } from '../utils/rand.ts'
import { isUint8Array } from '../utils/streams.ts'
import { getPdpDataSet } from '../warm-storage/get-pdp-data-set.ts'
import type { PdpDataSet } from '../warm-storage/types.ts'
import { addPieces } from './add-pieces.ts'
import {
  addPiecesFits,
  assertPieceCidSize,
  type Limiter,
  type LimiterOptions,
  type LimiterPiece,
} from './add-pieces-fits.ts'
import { waitForCreateDataSet } from './create-dataset.ts'
import { createDataSetAndAddPieces } from './create-dataset-add-pieces.ts'
import { findPiece } from './find-piece.ts'
import { waitForPullPieces } from './pull-pieces.ts'
import { type UploadPieceStreamingData, uploadPieceStreaming } from './upload-streaming.ts'

export type EnqueuePiece = LimiterPiece

export type FlushResult = {
  txHash: Hex
  statusUrl: string
  pieces: EnqueuePiece[]
}

export type PieceResult = FlushResult & {
  pieceCid: PieceCID
  batchIndex: number
}

/**
 * When to flush a tumbling addPieces window (limiter overflow, `flush()`, and
 * `close()` always flush regardless).
 *
 * - `delay`: wait `ms` once the window has a piece and no upload/pull is still
 *   parking (`ms: 0` is one macrotask). New parking work restarts the delay.
 * - `limiter`: no timer; sit until the next piece does not fit, or `flush`/`close`.
 */
export type PieceBatcherWait = { kind: 'delay'; ms: number } | { kind: 'limiter' }

/**
 * Called after the piece is on this SP, before it joins the addPieces window.
 * The callback is awaited, so a thrown error keeps the piece out of the batch
 * (retry with {@link PieceBatcher.enqueue}). {@link PieceBatcher.close} waits
 * for it the same way it waits for park/pull I/O.
 */
export type OnParked = (piece: EnqueuePiece) => void | Promise<void>

export type UploadInput = {
  data: File | Uint8Array | ReadableStream<Uint8Array>
  /** Known length for a stream (`File` uses `.size`). */
  size?: number
  metadata?: MetadataObject
  pieceCid?: PieceCID
  onParked?: OnParked
  onProgress?: (bytesUploaded: number) => void
  signal?: AbortSignal
}

export type PullInput = {
  pieceCid: PieceCID
  sourceUrl: string
  metadata?: MetadataObject
  onParked?: OnParked
}

type Slot = {
  piece: EnqueuePiece
  resolve: (result: PieceResult) => void
  reject: (error: unknown) => void
}

export type PieceBatcher = {
  /** Stream onto this SP, then join the addPieces window. */
  upload: (input: UploadInput) => Promise<PieceResult>
  /** Pull onto this SP (own extraData), then join the addPieces window. */
  pull: (input: PullInput) => Promise<PieceResult>
  /** Already on this SP. Join the addPieces window only. */
  enqueue: (piece: EnqueuePiece) => Promise<PieceResult>
  flush: () => Promise<FlushResult | undefined>
  close: () => Promise<void>
  readonly pending: readonly EnqueuePiece[]
  readonly dataSet: PdpDataSet | undefined
}

export namespace createPieceBatcher {
  export type OptionsType = {
    dataSet: PdpDataSet | undefined
    /** When to flush a window. Defaults to `{ kind: 'delay', ms: 0 }`. */
    wait?: PieceBatcherWait
    /** Defaults to {@link addPiecesFits}. */
    limiter?: Limiter
    /** Required when `dataSet` is undefined. */
    serviceURL?: string
    /** Required when `dataSet` is undefined. */
    payee?: Address
    payer?: Address
    metadata?: MetadataObject
    cdn?: boolean
  }
  export type ReturnType = PieceBatcher
}

/**
 * Create a stateful piece batcher that parks/pulls immediately and coalesces addPieces.
 *
 * `upload` and `pull` run per-piece I/O right away (`upload` uses the
 * streaming CommP-last protocol for bytes and streams). The tumbling window
 * only batches the on-chain addPieces (or createDataSetAndAddPieces) call.
 * Pull authorization uses `signAddPieces` for that one piece; flush signs a
 * new extraData for the whole window.
 *
 * @param client - Wallet client used to sign and submit.
 * @param options - {@link createPieceBatcher.OptionsType}
 * @returns Batcher {@link createPieceBatcher.ReturnType}
 *
 * @example
 * ```ts
 * import { createPieceBatcher } from '@filoz/synapse-core/sp'
 *
 * const batcher = createPieceBatcher(client, { dataSet })
 * await Promise.all([
 *   batcher.upload({ data: fileA }),
 *   batcher.pull({ pieceCid, sourceUrl }),
 * ])
 * await batcher.close()
 * ```
 */
export function createPieceBatcher(
  client: Client<Transport, Chain, Account>,
  options: createPieceBatcher.OptionsType
): createPieceBatcher.ReturnType {
  const wait: PieceBatcherWait = options.wait ?? { kind: 'delay', ms: 0 }
  if (wait.kind === 'delay' && !(wait.ms >= 0)) {
    throw new ValidationError('`wait.ms` must be a non-negative number.')
  }
  const limiter = options.limiter ?? addPiecesFits
  const datasetMetadata = options.metadata
  const cdn = options.cdn
  const payee = options.payee
  const payer = options.payer
  const createClientDataSetId = randU256()

  let dataSet = options.dataSet
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let timerToken: object | undefined
  let windowSlots: Slot[] = []
  let mutex: Promise<void> = Promise.resolve()
  const inFlight = new Set<Promise<unknown>>()
  let scheduled = 0
  let scheduledIdle = Promise.resolve()
  let resolveScheduledIdle: () => void = () => undefined

  function serviceURL(): string {
    if (dataSet != null) {
      return dataSet.provider.pdp.serviceURL
    }
    if (options.serviceURL == null) {
      throw new ValidationError('`serviceURL` is required when dataSet is undefined.')
    }
    return options.serviceURL
  }

  function limiterOptions(pieces: LimiterPiece[]): LimiterOptions {
    if (dataSet != null) {
      return { kind: 'addPieces', dataSet, pieces }
    }
    return { kind: 'createDataSetAndAddPieces', metadata: datasetMetadata, cdn, pieces }
  }

  function fits(pieces: LimiterPiece[]): boolean {
    return limiter(limiterOptions(pieces))
  }

  function lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = mutex.then(fn, fn)
    mutex = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  function track<T>(promise: Promise<T>): Promise<T> {
    cancelTimer()
    inFlight.add(promise)
    return promise.finally(() => {
      inFlight.delete(promise)
      if (inFlight.size === 0) {
        startTimer()
      }
    })
  }

  function beginSchedule(): void {
    if (scheduled === 0) {
      scheduledIdle = new Promise<void>((resolve) => {
        resolveScheduledIdle = () => {
          resolve()
        }
      })
    }
    scheduled++
  }

  function endSchedule(): void {
    scheduled--
    if (scheduled === 0) {
      resolveScheduledIdle()
    }
  }

  function assertOpen(): void {
    if (closed) {
      throw new ValidationError('Piece batcher is closed.')
    }
  }

  async function flushWindowInternal(): Promise<FlushResult | undefined> {
    cancelTimer()
    if (windowSlots.length === 0) {
      return undefined
    }
    const batch = windowSlots
    windowSlots = []
    const pieces = batch.map((slot) => slot.piece)

    try {
      const submitted =
        dataSet == null
          ? await flushCreate(pieces)
          : await addPieces(client, {
              serviceURL: serviceURL(),
              dataSetId: dataSet.dataSetId,
              clientDataSetId: dataSet.clientDataSetId,
              pieces,
            })

      const result: FlushResult = {
        txHash: submitted.txHash,
        statusUrl: submitted.statusUrl,
        pieces,
      }
      for (const [batchIndex, slot] of batch.entries()) {
        slot.resolve({
          ...result,
          pieceCid: slot.piece.pieceCid,
          batchIndex,
        })
      }
      return result
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error))
      for (const slot of batch) {
        slot.reject(
          new AddPiecesFlushError({
            pieceCid: slot.piece.pieceCid,
            metadata: slot.piece.metadata,
            pieces,
            cause,
          })
        )
      }
      return undefined
    }
  }

  async function flushCreate(pieces: EnqueuePiece[]): Promise<{ txHash: Hex; statusUrl: string }> {
    if (payee == null) {
      throw new ValidationError('`payee` is required when dataSet is undefined.')
    }
    const submitted = await createDataSetAndAddPieces(client, {
      serviceURL: serviceURL(),
      payee,
      payer,
      metadata: datasetMetadata,
      cdn,
      pieces,
      clientDataSetId: createClientDataSetId,
    })
    const created = await waitForCreateDataSet({ statusUrl: submitted.statusUrl })
    const resolved = await getPdpDataSet(client, { dataSetId: created.dataSetId })
    if (resolved == null) {
      throw new DataSetNotFoundError(created.dataSetId)
    }
    dataSet = resolved
    return submitted
  }

  function cancelTimer(): void {
    timerToken = undefined
    if (timer != null) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function startTimer(): void {
    if (wait.kind === 'limiter' || timerToken != null || windowSlots.length === 0 || inFlight.size > 0) {
      return
    }
    const token = {}
    timerToken = token
    timer = setTimeout(() => {
      if (timerToken !== token) {
        return
      }
      timer = undefined
      void lock(async () => {
        if (timerToken !== token || inFlight.size > 0) {
          return
        }
        timerToken = undefined
        await flushWindowInternal()
      })
    }, wait.ms)
  }

  function internalEnqueue(incoming: EnqueuePiece): Promise<PieceResult> {
    assertPieceCidSize(incoming.pieceCid)
    beginSchedule()
    return new Promise((resolve, reject) => {
      void lock(async () => {
        try {
          if (windowSlots.length > 0 && !fits([...windowSlots.map((slot) => slot.piece), incoming])) {
            await flushWindowInternal()
          }
          if (!fits([incoming])) {
            throw new ValidationError('Piece does not fit in a single addPieces operation.')
          }
          const slot: Slot = { piece: incoming, resolve, reject }
          windowSlots.push(slot)
          startTimer()
        } catch (error) {
          reject(error)
        } finally {
          endSchedule()
        }
      })
    })
  }

  async function parkAndEnqueue(park: () => Promise<EnqueuePiece>, onParked?: OnParked): Promise<PieceResult> {
    assertOpen()
    const parked = await track(
      (async () => {
        const piece = await park()
        assertPieceCidSize(piece.pieceCid)
        await onParked?.(piece)
        return piece
      })()
    )
    return internalEnqueue(parked)
  }

  async function enqueue(piece: EnqueuePiece): Promise<PieceResult> {
    assertOpen()
    return internalEnqueue(piece)
  }

  async function upload(input: UploadInput): Promise<PieceResult> {
    let data: UploadPieceStreamingData
    let size = input.size
    if (isUint8Array(input.data)) {
      data = input.data
      size = input.data.byteLength
    } else if (input.data instanceof Blob) {
      data = input.data.stream()
      size = input.data.size
    } else {
      data = input.data
    }
    return parkAndEnqueue(async () => {
      if (input.pieceCid != null) {
        assertPieceCidSize(input.pieceCid)
      }
      const uploaded = await uploadPieceStreaming({
        serviceURL: serviceURL(),
        data,
        size,
        pieceCid: input.pieceCid,
        onProgress: input.onProgress,
        signal: input.signal,
      })
      await findPiece({
        serviceURL: serviceURL(),
        pieceCid: uploaded.pieceCid,
        poll: true,
        signal: input.signal,
      })
      return { pieceCid: uploaded.pieceCid, metadata: input.metadata }
    }, input.onParked)
  }

  async function pull(input: PullInput): Promise<PieceResult> {
    return parkAndEnqueue(async () => {
      assertPieceCidSize(input.pieceCid)
      const signingPieces = [
        {
          pieceCid: input.pieceCid,
          metadata: pieceMetadataObjectToEntry(input.metadata),
        },
      ]
      const extraData = await signAddPieces(client, {
        clientDataSetId: dataSet == null ? createClientDataSetId : dataSet.clientDataSetId,
        pieces: signingPieces,
      })
      const pullPiece = {
        pieceCid: input.pieceCid,
        sourceUrl: input.sourceUrl,
        metadata: input.metadata,
      }
      const pullResult =
        dataSet == null
          ? await waitForPullPieces(client, {
              serviceURL: serviceURL(),
              pieces: [pullPiece],
              extraData,
              payee: requirePayee(),
              payer,
              cdn,
              metadata: datasetMetadata,
            })
          : await waitForPullPieces(client, {
              serviceURL: serviceURL(),
              pieces: [pullPiece],
              extraData,
              dataSetId: dataSet.dataSetId,
              clientDataSetId: dataSet.clientDataSetId,
            })
      if (pullResult.status === 'failed') {
        throw new PullError('Pull failed.')
      }
      return { pieceCid: input.pieceCid, metadata: input.metadata }
    }, input.onParked)
  }

  function requirePayee(): Address {
    if (payee == null) {
      throw new ValidationError('`payee` is required when dataSet is undefined.')
    }
    return payee
  }

  async function flush(): Promise<FlushResult | undefined> {
    return lock(() => flushWindowInternal())
  }

  async function close(): Promise<void> {
    closed = true
    await Promise.allSettled([...inFlight])
    await Promise.resolve()
    await scheduledIdle
    await lock(() => flushWindowInternal())
  }

  return {
    upload,
    pull,
    enqueue,
    flush,
    close,
    get pending() {
      return windowSlots.map((slot) => slot.piece)
    },
    get dataSet() {
      return dataSet
    },
  }
}
