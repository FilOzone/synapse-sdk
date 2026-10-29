import { AbortError } from 'iso-web/http'
import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { asChain } from '../chains.ts'
import { ValidationError } from '../errors/base.ts'
import { AddPiecesFlushError } from '../errors/pdp.ts'
import { PullError } from '../errors/pull.ts'
import { DataSetNotFoundError, PDPProviderUnavailableError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { createLimit, type Limit } from '../utils/concurrency.ts'
import type { MetadataObject } from '../utils/metadata.ts'
import { randU256 } from '../utils/rand.ts'
import { isUint8Array } from '../utils/streams.ts'
import { getPdpDataSet } from '../warm-storage/get-pdp-data-set.ts'
import type { PdpDataSet } from '../warm-storage/types.ts'
import { addPieces } from './add-pieces.ts'
import {
  addPiecesFits,
  assertPieceCidSize,
  assertPieceValid,
  type Limiter,
  type LimiterOptions,
  type LimiterPiece,
} from './add-pieces-fits.ts'
import { createDataSetAndAddPieces } from './create-dataset-add-pieces.ts'
import { findPiece } from './find-piece.ts'
import { type PullPieceInput, type pullPiecesApiRequest, waitForPullPieces } from './pull-pieces.ts'
import { type UploadPieceStreamingData, uploadPieceStreaming } from './upload-streaming.ts'
import { waitForAddPieces, waitForCreateDataSetAddPieces } from './wait-for-receipt.ts'

export type EnqueuePiece = LimiterPiece & {
  /** Raw byte size when the piece was parked by `upload()`. */
  size?: number
}

export type FlushResult = {
  txHash: Hex
  confirmedTxHash?: Hex
  /** The signed extra data that was submitted. Persist it with `txHash` to recover the outcome after a crash. */
  extraData: Hex
  /** The payer of the data set, as recorded by FWSS replay protection. */
  payer: Address
  dataSetId: bigint
  clientDataSetId: bigint
  isNewDataSet: boolean
  pieces: EnqueuePiece[]
  /** The on-chain outcome, already known when the flush created the data set. */
  receipt?: waitForAddPieces.OutputType
}

export type PieceResult = FlushResult & {
  pieceCid: PieceCID
  batchIndex: number
}

export type UploadResult = PieceResult & {
  size: number
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
 * When to send queued `pull()` calls as one pull request (limiter overflow, `maxPieces`, `flush()`, and `close()`
 * always send). The limiter is the same one used for addPieces, since the pull authorization is an addPieces
 * signature for exactly the pieces in that request.
 *
 * - `delay`: wait `ms` after the first pull joins an empty window (`ms: 0` is one macrotask).
 * - `limiter`: no timer; sit until the next piece does not fit or `maxPieces` is reached, or `flush`/`close`.
 *
 * `maxPieces` caps the pieces in one pull request (for example to stay under an SP's pull queue cap).
 * Defaults to no cap beyond the limiter.
 */
export type PullBatchWait = ({ kind: 'delay'; ms: number } | { kind: 'limiter' }) & { maxPieces?: number }

/**
 * Called after the piece is on this SP, before it joins the addPieces window.
 * The callback is awaited, so a thrown error keeps the piece out of the batch
 * (retry with {@link PieceBatcher.enqueue}). {@link PieceBatcher.close} waits
 * for it the same way it waits for park/pull I/O.
 */
export type OnParked = (piece: EnqueuePiece) => void | Promise<void>

export type UploadInput = {
  data: File | UploadPieceStreamingData
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
  /** Called on each poll of the batched pull request, with this piece's status only. */
  onStatus?: (response: waitForPullPieces.ReturnType) => void
  /** Stops waiting for this piece. The rest of its pull request carries on. */
  signal?: AbortSignal
}

type Slot = {
  piece: EnqueuePiece
  resolve: (result: PieceResult) => void
  reject: (error: unknown) => void
}

type PullSlot = {
  piece: PullPieceInput
  input: PullInput
  settled: boolean
  resolve: () => void
  reject: (error: unknown) => void
  /** Set by the pull request carrying this slot. */
  onSettled?: () => void
}

export type PieceBatcher = {
  /** Stream onto this SP, then join the addPieces window. */
  upload: (input: UploadInput) => Promise<UploadResult>
  /** Pull onto this SP in a batched pull request (see `pullWait`), then join the addPieces window. */
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
    /** When to send queued pulls as one pull request. Defaults to `{ kind: 'delay', ms: 0 }`. */
    pullWait?: PullBatchWait
    /** Defaults to {@link addPiecesFits}. */
    limiter?: Limiter
    /** Required when `dataSet` is undefined. */
    serviceURL?: string
    /** Required when `dataSet` is undefined. */
    payee?: Address
    payer?: Address
    metadata?: MetadataObject
    cdn?: boolean
    /**
     * Maximum number of `upload` transfers and batched pull requests in flight at the same time. Others wait for a
     * free slot. Defaults to no limit.
     */
    concurrency?: number
  }
  export type ReturnType = PieceBatcher
}

/**
 * Create a stateful piece batcher that parks/pulls immediately and coalesces addPieces.
 *
 * `upload` runs per-piece I/O right away (streaming CommP-last protocol for
 * bytes and streams). `pull` calls are coalesced into one pull request per
 * `pullWait` window, with one signature and one polling loop; each `pull`
 * promise still settles with its own piece's status. The tumbling window
 * batches the on-chain addPieces (or createDataSetAndAddPieces) call.
 * Pull authorization matches the operation for the pieces in that pull
 * request; flush signs new extraData for the whole window.
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
  const pullWait: PullBatchWait = options.pullWait ?? { kind: 'delay', ms: 0 }
  if (pullWait.kind === 'delay' && !(pullWait.ms >= 0)) {
    throw new ValidationError('`pullWait.ms` must be a non-negative number.')
  }
  if (pullWait.maxPieces != null && !(pullWait.maxPieces >= 1)) {
    throw new ValidationError('`pullWait.maxPieces` must be at least 1.')
  }
  const maxPullPieces = pullWait.maxPieces ?? Number.POSITIVE_INFINITY
  const limiter = options.limiter ?? addPiecesFits
  if (options.concurrency != null && !(options.concurrency >= 1)) {
    throw new ValidationError('`concurrency` must be at least 1.')
  }
  const limit = createLimit(options.concurrency ?? Number.POSITIVE_INFINITY)
  // Pulls take a `limit` slot per pull request (in `sendPullWindow`), not per piece.
  const unlimited: Limit = (task) => task()
  const legacyPieceStorageIdLimit = asChain(client.chain).legacyPieceStorageIdLimit
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
  let pullSlots: PullSlot[] = []
  let pullTimer: ReturnType<typeof setTimeout> | undefined
  let flushing = 0
  let mutex: Promise<void> = Promise.resolve()
  const inFlight = new Set<Promise<unknown>>()
  let scheduled = 0
  let scheduledIdle = Promise.resolve()
  let resolveScheduledIdle: () => void = () => undefined

  function serviceURL(): string {
    if (dataSet != null) {
      if (dataSet.provider == null) {
        throw new PDPProviderUnavailableError(dataSet.providerId)
      }
      return dataSet.provider.pdp.serviceURL
    }
    if (options.serviceURL == null) {
      throw new ValidationError('`serviceURL` is required when dataSet is undefined.')
    }
    return options.serviceURL
  }

  function limiterOptions(pieces: LimiterPiece[]): LimiterOptions {
    if (dataSet != null) {
      return { kind: 'addPieces', dataSet, dataSetId: dataSet.dataSetId, legacyPieceStorageIdLimit, pieces }
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
      const isNewDataSet = dataSet == null
      let submitted: Omit<FlushResult, 'isNewDataSet' | 'pieces'>
      if (dataSet == null) {
        submitted = await flushCreate(pieces)
      } else {
        const added = await addPieces(client, {
          serviceURL: serviceURL(),
          dataSetId: dataSet.dataSetId,
          clientDataSetId: dataSet.clientDataSetId,
          pieces,
        })
        submitted = {
          txHash: added.txHash,
          extraData: added.extraData,
          payer: dataSet.payer,
          dataSetId: dataSet.dataSetId,
          clientDataSetId: dataSet.clientDataSetId,
        }
      }

      const result: FlushResult = { ...submitted, isNewDataSet, pieces }
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

  async function flushCreate(pieces: EnqueuePiece[]): Promise<Omit<FlushResult, 'isNewDataSet' | 'pieces'>> {
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
    const created = await waitForCreateDataSetAddPieces({
      client,
      txHash: submitted.txHash,
      extraData: submitted.extraData,
      pieceCount: submitted.pieceCount,
    })
    const resolved = await getPdpDataSet(client, { dataSetId: created.dataSetId })
    if (resolved == null) {
      throw new DataSetNotFoundError(created.dataSetId)
    }
    dataSet = resolved
    return {
      txHash: submitted.txHash,
      ...(created.confirmedTxHash == null ? {} : { confirmedTxHash: created.confirmedTxHash }),
      extraData: submitted.extraData,
      payer: resolved.payer,
      dataSetId: created.dataSetId,
      clientDataSetId: createClientDataSetId,
      receipt: created,
    }
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
    assertPieceValid(incoming)
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

  async function parkAndEnqueue(
    park: () => Promise<EnqueuePiece>,
    onParked?: OnParked,
    parkLimit: Limit = limit
  ): Promise<PieceResult> {
    assertOpen()
    // Count the piece as scheduled from now until it is in the window, so `flush()` and `close()` wait for
    // pieces still waiting for a slot or parking.
    beginSchedule()
    let parked: EnqueuePiece
    try {
      parked = await track(
        parkLimit(async () => {
          const piece = await park()
          assertPieceValid(piece)
          await onParked?.(piece)
          return piece
        })
      )
    } catch (error) {
      endSchedule()
      throw error
    }
    const result = internalEnqueue(parked)
    endSchedule()
    return result
  }

  async function enqueue(piece: EnqueuePiece): Promise<PieceResult> {
    assertOpen()
    return internalEnqueue(piece)
  }

  async function upload(input: UploadInput): Promise<UploadResult> {
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
    let uploadedSize: number | undefined
    const result = await parkAndEnqueue(async () => {
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
      uploadedSize = uploaded.size
      await findPiece({
        serviceURL: serviceURL(),
        pieceCid: uploaded.pieceCid,
        poll: true,
        signal: input.signal,
      })
      return { pieceCid: uploaded.pieceCid, metadata: input.metadata, size: uploaded.size }
    }, input.onParked)
    if (uploadedSize == null) {
      throw new ValidationError('Piece upload completed without a size.')
    }
    return { ...result, size: uploadedSize }
  }

  /** Queue a piece in the pull window. Resolves once this piece is `complete` on this SP. */
  function queuePull(input: PullInput): Promise<void> {
    throwIfAborted(input.signal)
    const piece: PullPieceInput = { pieceCid: input.pieceCid, sourceUrl: input.sourceUrl, metadata: input.metadata }
    if (!fits([piece])) {
      throw new ValidationError('Piece does not fit in a single addPieces operation.')
    }
    if (pullSlots.length > 0) {
      const pieces = [...pullSlots.map((slot) => slot.piece), piece]
      if (pieces.length > maxPullPieces || !fits(pieces)) {
        sendPullWindow()
      }
    }
    return new Promise<void>((resolve, reject) => {
      function onAbort(this: AbortSignal): void {
        // Still queued: drop it from the window. Already sent: stop waiting, the request carries on.
        pullSlots = pullSlots.filter((queued) => queued !== slot)
        slot.reject(new AbortError(this))
      }
      const settle = (fn: () => void) => {
        if (slot.settled) {
          return
        }
        slot.settled = true
        input.signal?.removeEventListener('abort', onAbort)
        fn()
        slot.onSettled?.()
      }
      const slot: PullSlot = {
        piece,
        input,
        settled: false,
        resolve: () => settle(resolve),
        reject: (error) => settle(() => reject(error)),
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })
      pullSlots.push(slot)
      if (pullSlots.length >= maxPullPieces || flushing > 0) {
        sendPullWindow()
      } else if (pullWait.kind === 'delay' && pullTimer == null) {
        pullTimer = setTimeout(sendPullWindow, pullWait.ms)
      }
    })
  }

  function sendPullWindow(): void {
    if (pullTimer != null) {
      clearTimeout(pullTimer)
      pullTimer = undefined
    }
    if (pullSlots.length === 0) {
      return
    }
    const batch = pullSlots
    pullSlots = []
    // `pullBatch` settles every slot itself and never rejects.
    void limit(() => pullBatch(batch))
  }

  /** Send one pull request for the batch and settle each slot from its own piece status. */
  async function pullBatch(batch: PullSlot[]): Promise<void> {
    // Pieces aborted while waiting for a `limit` slot are left out of the request.
    const slots = batch.filter((slot) => !slot.settled)
    if (slots.length === 0) {
      return
    }
    // Stop polling once no caller is waiting (every piece settled or aborted).
    const controller = new AbortController()
    for (const slot of slots) {
      slot.onSettled = () => {
        if (slots.every((other) => other.settled)) {
          controller.abort()
        }
      }
    }
    const onStatus = (response: pullPiecesApiRequest.ReturnType) => {
      const statuses = new Map(response.pieces.map((piece) => [piece.pieceCid, piece.status]))
      for (const slot of slots) {
        const pieceCid = slot.piece.pieceCid.toString()
        const status = statuses.get(pieceCid)
        if (slot.settled || status == null) {
          continue
        }
        slot.input.onStatus?.({ status, pieces: [{ pieceCid, status }] })
        if (status === 'complete') {
          slot.resolve()
        } else if (status === 'failed') {
          slot.reject(new PullError('Pull failed.'))
        }
      }
    }
    try {
      const pieces = slots.map((slot) => slot.piece)
      if (dataSet == null) {
        await waitForPullPieces(client, {
          serviceURL: serviceURL(),
          pieces,
          clientDataSetId: createClientDataSetId,
          payee: requirePayee(),
          payer,
          cdn,
          metadata: datasetMetadata,
          signal: controller.signal,
          onStatus,
          waitForAll: true,
        })
      } else {
        await waitForPullPieces(client, {
          serviceURL: serviceURL(),
          pieces,
          dataSetId: dataSet.dataSetId,
          clientDataSetId: dataSet.clientDataSetId,
          signal: controller.signal,
          onStatus,
          waitForAll: true,
        })
      }
      // Settled pieces were handled in `onStatus`; this only reaches pieces missing from the response.
      for (const slot of slots) {
        slot.reject(new PullError('Pull failed.'))
      }
    } catch (error) {
      for (const slot of slots) {
        slot.reject(error)
      }
    }
  }

  async function pull(input: PullInput): Promise<PieceResult> {
    return parkAndEnqueue(
      async () => {
        assertPieceCidSize(input.pieceCid)
        await queuePull(input)
        return { pieceCid: input.pieceCid, metadata: input.metadata }
      },
      input.onParked,
      unlimited
    )
  }

  function requirePayee(): Address {
    if (payee == null) {
      throw new ValidationError('`payee` is required when dataSet is undefined.')
    }
    return payee
  }

  async function flush(): Promise<FlushResult | undefined> {
    // Send queued pulls now, and any that arrive while waiting, so `flush()` never waits on a pull window.
    flushing++
    try {
      sendPullWindow()
      await scheduledIdle
    } finally {
      flushing--
    }
    return lock(() => flushWindowInternal())
  }

  async function close(): Promise<void> {
    closed = true
    await flush()
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

export namespace waitForFlushReceipt {
  export type OptionsType = Omit<
    waitForAddPieces.OptionsType,
    'client' | 'txHash' | 'extraData' | 'payer' | 'pieceCount'
  >
  export type OutputType = waitForAddPieces.OutputType
  export type ErrorType = waitForAddPieces.ErrorType
}

/**
 * Wait for a flushed batch to land on chain and get its piece IDs.
 *
 * Follows replace-by-fee replacements with {@link waitForAddPieces}. A flush that created the
 * data set already waited for its transaction, so its outcome is returned without waiting again.
 *
 * @param client - The client to wait with.
 * @param result - The flush result, from {@link PieceBatcher.flush} or any piece's result.
 * @param options - {@link waitForFlushReceipt.OptionsType}
 * @returns The outcome {@link waitForFlushReceipt.OutputType}. `pieceIds[batchIndex]` is a piece's ID.
 * @throws Errors {@link waitForFlushReceipt.ErrorType}
 *
 * @example
 * ```ts
 * import { createPieceBatcher, waitForFlushReceipt } from '@filoz/synapse-core/sp'
 *
 * const batcher = createPieceBatcher(client, { dataSet })
 * const result = await batcher.upload({ data: file })
 * const { pieceIds } = await waitForFlushReceipt(client, result)
 * const pieceId = pieceIds[result.batchIndex]
 * ```
 */
export async function waitForFlushReceipt(
  client: Client<Transport, Chain>,
  result: FlushResult,
  options: waitForFlushReceipt.OptionsType = {}
): Promise<waitForFlushReceipt.OutputType> {
  if (result.receipt != null) {
    return result.receipt
  }
  return waitForAddPieces({
    ...options,
    client,
    txHash: result.txHash,
    extraData: result.extraData,
    payer: result.payer,
    pieceCount: result.pieces.length,
  })
}
