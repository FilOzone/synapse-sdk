import * as SP from '@filoz/synapse-core/sp'
import type { Hex } from 'viem'
import type { Synapse } from '../synapse.ts'
import type { PieceBatchingOptions, PieceCID } from '../types.ts'
import type { StorageContext } from './context.ts'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export type BatchedCommitResult = {
  pieceCid: PieceCID
  txHash: Hex
  confirmedTxHash?: Hex
  dataSetId: bigint
  pieceId: bigint
  isNewDataSet: boolean
}

export type BatchedUploadResult = BatchedCommitResult & {
  size: number
}

export type BatchedTask<T> = {
  parked: Promise<SP.EnqueuePiece>
  committed: Promise<T>
}

export type BatchingHold = {
  release: () => void
}

type Entry = {
  batcher: SP.PieceBatcher
  providerId: bigint
  contexts: Set<StorageContext>
  confirmations: Map<string, Promise<SP.waitForAddPieces.OutputType>>
}

type TaskCallbacks = {
  onParked?: SP.OnParked
  onSubmitted?: (result: SP.PieceResult) => void
}

export type UploadTaskInput = Omit<SP.UploadInput, 'onParked'> & TaskCallbacks
export type PullTaskInput = Omit<SP.PullInput, 'onParked'> & TaskCallbacks

const services = new WeakMap<Synapse, PieceBatchingService>()

export function registerPieceBatchingService(synapse: Synapse, service: PieceBatchingService): void {
  services.set(synapse, service)
}

export function getPieceBatchingService(synapse: Synapse): PieceBatchingService | undefined {
  return services.get(synapse)
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function metadataKey(metadata: Record<string, string>): string {
  return JSON.stringify(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)))
}

export class PieceBatchingService {
  private readonly synapse: Synapse
  private readonly options: PieceBatchingOptions
  private readonly entries = new Map<string, Promise<Entry>>()
  private readonly pendingReady = new Set<Promise<void>>()

  constructor(synapse: Synapse, options: PieceBatchingOptions) {
    this.synapse = synapse
    this.options = options
  }

  upload(context: StorageContext, input: UploadTaskInput): BatchedTask<BatchedUploadResult> {
    return this.task(context, input, async (entry, onParked) => {
      const { onSubmitted, ...batchInput } = input
      const result = await entry.batcher.upload({ ...batchInput, onParked })
      onSubmitted?.(result)
      const committed = await this.confirm(entry, result)
      return { ...committed, size: result.size }
    })
  }

  pull(context: StorageContext, input: PullTaskInput): BatchedTask<BatchedCommitResult> {
    return this.task(context, input, async (entry, onParked) => {
      const { onSubmitted, ...batchInput } = input
      const result = await entry.batcher.pull({ ...batchInput, onParked })
      onSubmitted?.(result)
      return this.confirm(entry, result)
    })
  }

  hold(): BatchingHold {
    const ready = deferred<void>()
    this.trackReady(ready)
    return { release: () => ready.resolve() }
  }

  async flush(): Promise<void> {
    while (this.pendingReady.size > 0) {
      await Promise.allSettled([...this.pendingReady])
    }
    const entries = await Promise.allSettled([...new Set(this.entries.values())])
    await Promise.all(entries.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value.batcher.flush()] : [])))
  }

  private task<T>(
    context: StorageContext,
    input: TaskCallbacks,
    run: (entry: Entry, onParked: SP.OnParked) => Promise<T>
  ): BatchedTask<T> {
    const parked = deferred<SP.EnqueuePiece>()
    void parked.promise.catch(() => undefined)
    const ready = deferred<void>()
    this.trackReady(ready)

    let didPark = false
    const committed = (async () => {
      try {
        const entry = await this.entry(context)
        return await run(entry, async (piece) => {
          didPark = true
          parked.resolve(piece)
          try {
            await input.onParked?.(piece)
          } finally {
            ready.resolve()
          }
        })
      } catch (error) {
        if (!didPark) {
          parked.reject(error)
          ready.resolve()
        }
        throw error
      }
    })()
    void committed.catch(() => undefined)

    return { parked: parked.promise, committed }
  }

  private trackReady(ready: Deferred<void>): void {
    this.pendingReady.add(ready.promise)
    void ready.promise.finally(() => {
      this.pendingReady.delete(ready.promise)
    })
  }

  private entry(context: StorageContext): Promise<Entry> {
    const key = this.key(context)
    const existing = this.entries.get(key)
    if (existing != null) {
      void existing.then((entry) => {
        const dataSet = entry.batcher.dataSet
        if (dataSet == null) {
          entry.contexts.add(context)
        } else {
          context.syncBatcherDataSet(dataSet.dataSetId, dataSet.clientDataSetId)
        }
      })
      return existing
    }

    const created = this.createEntry(context)
    this.entries.set(key, created)
    void created.catch(() => {
      if (this.entries.get(key) === created) {
        this.entries.delete(key)
      }
    })
    return created
  }

  private async createEntry(context: StorageContext): Promise<Entry> {
    const dataSet = await context.getBatcherDataSet()

    return {
      batcher: SP.createPieceBatcher(this.synapse.sessionClient ?? this.synapse.client, {
        dataSet,
        wait: this.options.wait,
        serviceURL: context.provider.pdp.serviceURL,
        payee: context.provider.serviceProvider,
        payer: this.synapse.client.account.address,
        metadata: context.dataSetMetadata,
        cdn: context.withCDN,
      }),
      providerId: context.provider.id,
      contexts: dataSet == null ? new Set([context]) : new Set(),
      confirmations: new Map(),
    }
  }

  private async confirm(entry: Entry, result: SP.PieceResult): Promise<BatchedCommitResult> {
    const dataSet = entry.batcher.dataSet
    if (dataSet != null) {
      for (const context of entry.contexts) {
        context.syncBatcherDataSet(dataSet.dataSetId, dataSet.clientDataSetId)
      }
      entry.contexts.clear()
      this.entries.set(this.existingKey(entry.providerId, dataSet.dataSetId), Promise.resolve(entry))
    }

    let confirmation = entry.confirmations.get(result.statusUrl)
    if (confirmation == null) {
      confirmation = SP.waitForAddPieces({ statusUrl: result.statusUrl })
      entry.confirmations.set(result.statusUrl, confirmation)
      void confirmation.then(
        () => entry.confirmations.delete(result.statusUrl),
        () => entry.confirmations.delete(result.statusUrl)
      )
    }
    const confirmed = await confirmation
    const pieceId = confirmed.confirmedPieceIds[result.batchIndex]
    if (pieceId == null) {
      throw new Error(`Provider confirmed no piece ID at batch index ${result.batchIndex}`)
    }

    const confirmedTxHash = result.confirmedTxHash ?? confirmed.confirmedTxHash
    return {
      pieceCid: result.pieceCid,
      txHash: result.txHash,
      ...(confirmedTxHash == null ? {} : { confirmedTxHash }),
      dataSetId: result.dataSetId,
      pieceId,
      isNewDataSet: result.isNewDataSet,
    }
  }

  private key(context: StorageContext): string {
    if (context.dataSetId != null) {
      return this.existingKey(context.provider.id, context.dataSetId)
    }
    return `new:${context.provider.id}:${context.withCDN}:${metadataKey(context.dataSetMetadata)}`
  }

  private existingKey(providerId: bigint, dataSetId: bigint): string {
    return `existing:${providerId}:${dataSetId}`
  }
}
