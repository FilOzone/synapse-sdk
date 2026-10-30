import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { asChain } from '../chains.ts'
import { ValidationError } from '../errors/base.ts'
import { AddPiecesFlushError } from '../errors/pdp.ts'
import { DataSetNotFoundError, PDPProviderUnavailableError } from '../errors/warm-storage.ts'
import { from as pieceCidFrom } from '../piece/parse.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import {
  addPiecesFits,
  assertPieceValid,
  type Limiter,
  type LimiterOptions,
  type LimiterPiece,
} from '../utils/add-pieces-fits.ts'
import { createLimit, type Limit } from '../utils/concurrency.ts'
import { type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { randU256 } from '../utils/rand.ts'
import { isUint8Array } from '../utils/streams.ts'
import { getPdpDataSet } from '../warm-storage/get-pdp-data-set.ts'
import type { PdpDataSet } from '../warm-storage/types.ts'
import { addPieces } from './add-pieces.ts'
import { createDataSetAndAddPieces } from './create-dataset-add-pieces.ts'
import { findPiece } from './find-piece.ts'
import { createPullBatcher, type PullBatchInput, type PullTarget } from './pull-batcher.ts'
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

/** One piece of a {@link SubmittedBatch}, in JSON-safe form. */
export type SubmittedPiece = {
  /** The PieceCID string. */
  pieceCid: string
  metadata?: MetadataObject
  /** Raw byte size when the piece was parked by `upload()`. */
  size?: number
}

/**
 * A flushed window that the provider accepted, before its transaction is confirmed.
 *
 * The record is JSON-safe: `JSON.parse(JSON.stringify(batch))` gives back an equal value. Ids are decimal strings
 * (not `bigint`) and PieceCIDs are strings. Persist it from {@link OnSubmitted}. After a restart, pass it to
 * {@link PieceBatcher.resume} instead of adding the same pieces again.
 *
 * An `addPieces` record also holds everything `waitForAddPieces` and `getAddPiecesResult` need. A
 * `createDataSetAndAddPieces` record holds what `waitForCreateDataSetAddPieces` and
 * `getCreateDataSetAndAddPiecesResult` need.
 */
export type SubmittedBatch = {
  /** The original transaction hash returned by the provider. */
  txHash: Hex
  /** The signed extra data that was submitted. Waits use it to find the outcome even after a replace-by-fee. */
  extraData: Hex
  /** Client data set id as a decimal string. */
  clientDataSetId: string
  /** The pieces in submission order. A piece's index here is its `batchIndex`. */
  pieces: SubmittedPiece[]
} & (
  | {
      kind: 'addPieces'
      /** Data set id as a decimal string. */
      dataSetId: string
      /** The payer of the data set. */
      payer: Address
    }
  | { kind: 'createDataSetAndAddPieces' }
)

/**
 * Called once per flushed window, after the provider accepts the addPieces (or createDataSetAndAddPieces) call and
 * before any piece promise of that window settles. It is awaited, so it can persist the record first.
 *
 * If it throws, the window's piece promises reject with that error, not {@link AddPiecesFlushError}. The transaction
 * was already submitted and may still land, so do not enqueue those pieces again. A created data set is still
 * waited for and adopted, so later pieces go into it instead of a second data set.
 */
export type OnSubmitted = (batch: SubmittedBatch) => void | Promise<void>

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

export type PullInput = PullBatchInput & {
  onParked?: OnParked
}

type Slot = {
  piece: EnqueuePiece
  resolve: (result: PieceResult) => void
  reject: (error: unknown) => void
}

export type PieceBatcher = {
  /** Stream onto this SP, then join the addPieces window. */
  upload: (input: UploadInput) => Promise<UploadResult>
  /** Pull onto this SP in a batched pull request (see `pullDelay`), then join the addPieces window. */
  pull: (input: PullInput) => Promise<PieceResult>
  /** Already on this SP. Join the addPieces window only. */
  enqueue: (piece: EnqueuePiece) => Promise<PieceResult>
  flush: () => Promise<FlushResult | undefined>
  /**
   * Settle a batch that an earlier run submitted (see {@link OnSubmitted}), without submitting it again.
   *
   * Resolves with the {@link FlushResult} that `flush()` gave for that batch. For `createDataSetAndAddPieces` it
   * waits for the data set to be created and adopts it, so later pieces are added to it rather than to a second data
   * set. Call it before enqueuing new work. Confirm the pieces with {@link waitForFlushReceipt}, as for any flush.
   */
  resume: (batch: SubmittedBatch) => Promise<FlushResult>
  close: () => Promise<void>
  readonly pending: readonly EnqueuePiece[]
  readonly dataSet: PdpDataSet | undefined
}

export namespace createPieceBatcher {
  export type OptionsType = {
    dataSet: PdpDataSet | undefined
    /** When to flush a window. Defaults to `{ kind: 'delay', ms: 0 }`. */
    wait?: PieceBatcherWait
    /**
     * Milliseconds to wait after a pull joins an empty queue before sending queued pulls as pull requests of up to
     * `SIZE_CONSTANTS.PULL_BATCH_SIZE` pieces. Defaults to 0 (one macrotask).
     */
    pullDelay?: number
    /** Sizes the addPieces windows; batched pull requests are not split by it. Defaults to {@link addPiecesFits}. */
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
    /** Called once per flushed window, before its pieces settle. See {@link OnSubmitted}. */
    onSubmitted?: OnSubmitted
  }
  export type ReturnType = PieceBatcher
}

/**
 * Create a stateful piece batcher that parks/pulls immediately and coalesces addPieces.
 *
 * `upload` runs per-piece I/O right away (streaming CommP-last protocol for
 * bytes and streams). `pull` calls are coalesced into pull requests of up to
 * `SIZE_CONSTANTS.PULL_BATCH_SIZE` pieces, each with one signature and
 * one polling loop; each `pull` promise still settles with its own piece's
 * status, and a full SP pull queue (429) is waited out. The tumbling window
 * batches the on-chain addPieces (or createDataSetAndAddPieces) call.
 * Pull authorization matches the operation for the pieces in that pull
 * request; flush signs new extraData for the whole window.
 *
 * Invalid metadata or an out-of-bounds PieceCID size rejects only that piece
 * when it is passed to `upload`/`pull`/`enqueue`, before any network work; it
 * never joins a pull request or a window. A failed flush (signing, RPC, SP or
 * chain errors) rejects every piece in the window with {@link AddPiecesFlushError}.
 *
 * For crash recovery, persist each window from `onSubmitted` and pass it to
 * `resume()` after a restart instead of adding the same pieces again.
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
  if (options.pullDelay != null && !(options.pullDelay >= 0)) {
    throw new ValidationError('`pullDelay` must be a non-negative number.')
  }
  const limiter = options.limiter ?? addPiecesFits
  if (options.concurrency != null && !(options.concurrency >= 1)) {
    throw new ValidationError('`concurrency` must be at least 1.')
  }
  const limit = createLimit(options.concurrency ?? Number.POSITIVE_INFINITY)
  // Pulls take a `limit` slot per pull request (in the pull batcher), not per piece.
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
  let mutex: Promise<void> = Promise.resolve()
  const inFlight = new Set<Promise<unknown>>()
  let scheduled = 0
  let scheduledIdle = Promise.resolve()
  let resolveScheduledIdle: () => void = () => undefined
  const pulls = createPullBatcher(client, { target: pullTarget, limit, delay: options.pullDelay })

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
      const submitted = await submit(pieces)
      try {
        await options.onSubmitted?.(submitted)
      } catch (error) {
        // Still settle, so a created data set is adopted and the next flush does not create a second one. The
        // transaction is already on its way, so reject with the hook error: an AddPiecesFlushError would invite a
        // duplicate retry.
        await settle(submitted, pieces).catch(() => undefined)
        for (const slot of batch) {
          slot.reject(error)
        }
        return undefined
      }
      const result = await settle(submitted, pieces)
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

  /** Send a window to the provider as addPieces, or createDataSetAndAddPieces when there is no data set yet. */
  async function submit(pieces: EnqueuePiece[]): Promise<SubmittedBatch> {
    const submittedPieces = pieces.map(toSubmittedPiece)
    if (dataSet == null) {
      const created = await createDataSetAndAddPieces(client, {
        serviceURL: serviceURL(),
        payee: requirePayee(),
        payer,
        metadata: datasetMetadata,
        cdn,
        pieces,
        clientDataSetId: createClientDataSetId,
      })
      return {
        kind: 'createDataSetAndAddPieces',
        txHash: created.txHash,
        extraData: created.extraData,
        clientDataSetId: createClientDataSetId.toString(),
        pieces: submittedPieces,
      }
    }
    const added = await addPieces(client, {
      serviceURL: serviceURL(),
      dataSetId: dataSet.dataSetId,
      clientDataSetId: dataSet.clientDataSetId,
      pieces,
    })
    return {
      kind: 'addPieces',
      txHash: added.txHash,
      extraData: added.extraData,
      payer: dataSet.payer,
      dataSetId: dataSet.dataSetId.toString(),
      clientDataSetId: dataSet.clientDataSetId.toString(),
      pieces: submittedPieces,
    }
  }

  /**
   * Turn a submitted batch into its flush result. Shared by `flush()` and `resume()`, so a resumed batch settles
   * exactly as it would have in the run that submitted it.
   */
  async function settle(batch: SubmittedBatch, pieces: EnqueuePiece[]): Promise<FlushResult> {
    const clientDataSetId = BigInt(batch.clientDataSetId)
    if (batch.kind === 'addPieces') {
      const adopted = await adoptDataSet(BigInt(batch.dataSetId))
      return {
        txHash: batch.txHash,
        extraData: batch.extraData,
        payer: adopted.payer,
        dataSetId: adopted.dataSetId,
        clientDataSetId,
        isNewDataSet: false,
        pieces,
      }
    }
    const created = await waitForCreateDataSetAddPieces({
      client,
      txHash: batch.txHash,
      extraData: batch.extraData,
      pieceCount: pieces.length,
    })
    const adopted = await adoptDataSet(created.dataSetId)
    return {
      txHash: batch.txHash,
      ...(created.confirmedTxHash == null ? {} : { confirmedTxHash: created.confirmedTxHash }),
      extraData: batch.extraData,
      payer: adopted.payer,
      dataSetId: created.dataSetId,
      clientDataSetId,
      isNewDataSet: true,
      pieces,
      receipt: created,
    }
  }

  /** Point the batcher at `dataSetId`, so a batcher made for a new data set does not create a second one. */
  async function adoptDataSet(dataSetId: bigint): Promise<PdpDataSet> {
    if (dataSet != null) {
      if (dataSet.dataSetId !== dataSetId) {
        throw new ValidationError(
          `Submitted batch is for data set ${dataSetId}, but this batcher adds to data set ${dataSet.dataSetId}.`
        )
      }
      return dataSet
    }
    const resolved = await getPdpDataSet(client, { dataSetId })
    if (resolved == null) {
      throw new DataSetNotFoundError(dataSetId)
    }
    dataSet = resolved
    return resolved
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
    try {
      return internalEnqueue(parked)
    } finally {
      endSchedule()
    }
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
      // Checked before uploading, so a piece that can never be added is not uploaded.
      if (input.pieceCid == null) {
        pieceMetadataObjectToEntry(input.metadata)
      } else {
        assertPieceValid({ pieceCid: input.pieceCid, metadata: input.metadata })
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

  function pullTarget(): PullTarget {
    if (dataSet == null) {
      return {
        serviceURL: serviceURL(),
        clientDataSetId: createClientDataSetId,
        payee: requirePayee(),
        payer,
        cdn,
        metadata: datasetMetadata,
      }
    }
    return { serviceURL: serviceURL(), dataSetId: dataSet.dataSetId, clientDataSetId: dataSet.clientDataSetId }
  }

  async function pull(input: PullInput): Promise<PieceResult> {
    return parkAndEnqueue(
      async () => {
        // Checked before pulling, so a piece that can never be added is not pulled, and bad metadata fails only its
        // own pull rather than the signing of the whole pull request.
        assertPieceValid(input)
        if (!fits([input])) {
          throw new ValidationError('Piece does not fit in a single addPieces operation.')
        }
        await pulls.pull(input)
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
    pulls.flush()
    await scheduledIdle
    return lock(() => flushWindowInternal())
  }

  async function resume(batch: SubmittedBatch): Promise<FlushResult> {
    assertOpen()
    const pieces = fromSubmittedBatch(batch)
    return lock(() => settle(batch, pieces))
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
    resume,
    close,
    get pending() {
      return windowSlots.map((slot) => slot.piece)
    },
    get dataSet() {
      return dataSet
    },
  }
}

function toSubmittedPiece(piece: EnqueuePiece): SubmittedPiece {
  return {
    pieceCid: piece.pieceCid.toString(),
    ...(piece.metadata == null ? {} : { metadata: piece.metadata }),
    ...(piece.size == null ? {} : { size: piece.size }),
  }
}

const DECIMAL = /^\d+$/

/**
 * Check a persisted {@link SubmittedBatch} and parse its pieces.
 *
 * @param batch - The batch to check.
 * @returns The batch pieces with parsed PieceCIDs.
 * @throws {ValidationError} When the batch is malformed.
 */
function fromSubmittedBatch(batch: SubmittedBatch): EnqueuePiece[] {
  if (batch.kind !== 'addPieces' && batch.kind !== 'createDataSetAndAddPieces') {
    throw new ValidationError('Submitted batch `kind` must be "addPieces" or "createDataSetAndAddPieces".')
  }
  if (!DECIMAL.test(batch.clientDataSetId)) {
    throw new ValidationError('Submitted batch `clientDataSetId` must be a decimal string.')
  }
  if (batch.kind === 'addPieces' && !DECIMAL.test(batch.dataSetId)) {
    throw new ValidationError('Submitted addPieces batch `dataSetId` must be a decimal string.')
  }
  if (batch.pieces.length === 0) {
    throw new ValidationError('Submitted batch has no pieces.')
  }
  return batch.pieces.map((piece) => {
    let pieceCid: PieceCID
    try {
      pieceCid = pieceCidFrom(piece.pieceCid)
    } catch (error) {
      throw new ValidationError(`Submitted batch has an invalid PieceCID: ${piece.pieceCid}`, {
        cause: error instanceof Error ? error : undefined,
      })
    }
    return {
      pieceCid,
      ...(piece.metadata == null ? {} : { metadata: piece.metadata }),
      ...(piece.size == null ? {} : { size: piece.size }),
    }
  })
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
