import { AbortError } from 'iso-web/http'
import type { Account, Chain, Client, Transport } from 'viem'
import { PullError } from '../errors/pull.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { throwIfAborted } from '../utils/abort.ts'
import type { Limit } from '../utils/concurrency.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import type { MetadataObject } from '../utils/metadata.ts'
import {
  type PullPieceInput,
  type PullToExistingDataSetOptions,
  type PullToNewDataSetOptions,
  waitForPullPieces,
} from './pull-pieces.ts'

export type PullBatchInput = {
  pieceCid: PieceCID
  sourceUrl: string
  metadata?: MetadataObject
  /** Called on each poll of the batched pull request, with this piece's status only. */
  onStatus?: (response: waitForPullPieces.ReturnType) => void
  /** Stops waiting for this piece. The rest of its pull request carries on. */
  signal?: AbortSignal
}

/** Where a pull request goes and what its authorization signs for. Read when each request is sent. */
export type PullTarget =
  | Pick<PullToExistingDataSetOptions, 'serviceURL' | 'dataSetId' | 'clientDataSetId'>
  | Pick<PullToNewDataSetOptions, 'serviceURL' | 'clientDataSetId' | 'payee' | 'payer' | 'cdn' | 'metadata'>

export namespace createPullBatcher {
  export type OptionsType = {
    target: () => PullTarget
    /** Wraps each pull request, for example to share a concurrency limit. */
    limit?: Limit
    /** Milliseconds to wait after a pull joins an empty queue before sending. Defaults to 0 (one macrotask). */
    delay?: number
  }
}

export type PullBatcher = {
  /** Queue a pull. Resolves once this piece is `complete` on the SP. */
  pull: (input: PullBatchInput) => Promise<void>
  /** Send every queued pull now. */
  flush: () => void
}

type QueuedPull = {
  piece: PullPieceInput
  input: PullBatchInput
  settled: boolean
  resolve: () => void
  reject: (error: unknown) => void
  /** Set by the pull request carrying this pull. */
  onSettled?: () => void
}

/**
 * Coalesce pulls into pull requests of up to {@link SIZE_CONSTANTS.PULL_BATCH_SIZE} pieces, each with one signature
 * and one polling loop. Each pull settles from its own piece's status.
 *
 * The signature is an addPieces authorization for the request's pieces. Requests are not split by an addPieces
 * limiter: even with maximum metadata, far more than {@link SIZE_CONSTANTS.PULL_BATCH_SIZE} pieces fit one addPieces
 * message, and the legacy data set cap is higher too.
 *
 * There is no client-side cap on pieces in flight: when the SP's pull queue is full it answers 429 with
 * `Retry-After`, and {@link waitForPullPieces} waits and retries.
 */
export function createPullBatcher(
  client: Client<Transport, Chain, Account>,
  options: createPullBatcher.OptionsType
): PullBatcher {
  const delay = options.delay ?? 0
  const limit: Limit = options.limit ?? ((task) => task())
  let queue: QueuedPull[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  function pull(input: PullBatchInput): Promise<void> {
    throwIfAborted(input.signal)
    const piece: PullPieceInput = { pieceCid: input.pieceCid, sourceUrl: input.sourceUrl, metadata: input.metadata }
    return new Promise<void>((resolve, reject) => {
      const queued: QueuedPull = {
        piece,
        input,
        settled: false,
        resolve: () => settle(resolve),
        reject: (error) => settle(() => reject(error)),
      }
      function settle(fn: () => void): void {
        if (queued.settled) {
          return
        }
        queued.settled = true
        input.signal?.removeEventListener('abort', onAbort)
        fn()
        queued.onSettled?.()
      }
      function onAbort(this: AbortSignal): void {
        // Still queued: drop it. Already sent: stop waiting, the request carries on.
        queue = queue.filter((other) => other !== queued)
        queued.reject(new AbortError(this))
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })
      queue.push(queued)
      if (queue.length >= SIZE_CONSTANTS.PULL_BATCH_SIZE) {
        flush()
      } else if (timer == null) {
        timer = setTimeout(flush, delay)
      }
    })
  }

  function flush(): void {
    clearTimeout(timer)
    timer = undefined
    while (queue.length > 0) {
      const batch = queue.slice(0, SIZE_CONSTANTS.PULL_BATCH_SIZE)
      queue = queue.slice(SIZE_CONSTANTS.PULL_BATCH_SIZE)
      // `send` settles every pull itself and never rejects.
      void limit(() => send(batch))
    }
  }

  async function send(batch: QueuedPull[]): Promise<void> {
    // Pulls aborted while waiting for a `limit` slot are left out of the request.
    const pulls = batch.filter((queued) => !queued.settled)
    if (pulls.length === 0) {
      return
    }
    // Stop polling once no caller is waiting (every piece settled or aborted).
    const controller = new AbortController()
    let waiting = pulls.length
    for (const queued of pulls) {
      queued.onSettled = () => {
        waiting--
        if (waiting === 0) {
          controller.abort()
        }
      }
    }
    const onStatus = (response: waitForPullPieces.ReturnType) => {
      for (const { pieceCid, status, index } of response.pieces) {
        const queued = pulls[index]
        if (queued == null || queued.settled) {
          continue
        }
        try {
          queued.input.onStatus?.({ status, pieces: [{ pieceCid, status, index: 0 }] })
        } catch (error) {
          // A throwing callback fails only its own pull, not the rest of the request.
          queued.reject(error)
          continue
        }
        if (status === 'complete') {
          queued.resolve()
        } else if (status === 'failed') {
          queued.reject(new PullError('Pull failed.'))
        }
      }
    }
    try {
      await waitForPullPieces(client, {
        ...options.target(),
        pieces: pulls.map((queued) => queued.piece),
        signal: controller.signal,
        onStatus,
      })
      // Settled pieces were handled in `onStatus`; this only reaches pieces still unsettled when polling ends.
      for (const queued of pulls) {
        queued.reject(new PullError('Pull failed.'))
      }
    } catch (error) {
      for (const queued of pulls) {
        queued.reject(error)
      }
    }
  }

  return { pull, flush }
}
