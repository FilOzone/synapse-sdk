import type { PieceCID } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import type { MetadataObject } from '@filoz/synapse-core/utils'
import type { PdpDataSet } from '@filoz/synapse-core/warm-storage'
import type { Account, Chain, Client, Transport } from 'viem'

/**
 * Progress of one file in `useUploadPieces`.
 */
export interface UploadPiecesFileProgress {
  /** The file being uploaded. */
  file: File
  /** The index of the file in `files`. */
  index: number
  /** Bytes sent to the provider so far. */
  bytesUploaded: number
}

/**
 * The variables for the useUploadPieces mutation.
 */
export interface UseUploadPiecesVariables {
  /** The data set to add the pieces to. */
  dataSet: PdpDataSet
  /** The files to upload. Each file becomes one piece. */
  files: File[]
  /**
   * The piece metadata for each file.
   *
   * @param file - The file being uploaded.
   */
  metadata?: (file: File) => MetadataObject
  /** The signal to abort the uploads. */
  signal?: AbortSignal
}

/**
 * A piece uploaded and added to the data set by `useUploadPieces`.
 */
export interface UploadedPiece {
  /** The source file. */
  file: File
  /** The PieceCID. */
  pieceCid: PieceCID
  /** The piece id in the data set, from the confirmed add-pieces transaction. */
  pieceId: bigint | undefined
  /** The raw size of the piece in bytes. */
  size: number
  /** The metadata stored with the piece. */
  metadata: MetadataObject | undefined
}

/**
 * The result for the useUploadPieces mutation.
 */
export interface UseUploadPiecesResult {
  /**
   * The provider confirmations of the add-pieces transactions, one per transaction.
   * All files go in one transaction unless they don't fit in a single add-pieces request.
   */
  confirmations: SP.waitForAddPieces.OutputType[]
  /** The pieces added to the data set, in file order. */
  pieces: UploadedPiece[]
  /** The files that failed to upload or to be added. Retry them with a new mutation. */
  failed: { file: File; error: Error }[]
}

/**
 * The options for {@link uploadPieces}.
 */
export interface UploadPiecesOptions extends UseUploadPiecesVariables {
  /** The maximum number of files streamed to the provider at the same time. Defaults to 4. */
  concurrency?: number
  /** The callback to call when a file makes upload progress. */
  onFileProgress?: (progress: UploadPiecesFileProgress) => void
  /** The callback to call when an add-pieces transaction hash is available. */
  onHash?: (hash: string) => void
}

/**
 * Stream files to a data set's provider, add every parked piece in one add-pieces request and wait for it to be
 * confirmed. Used by `useUploadPieces`.
 *
 * @param client - The client to sign with.
 * @param options - {@link UploadPiecesOptions}
 * @returns The upload result. {@link UseUploadPiecesResult}
 */
export async function uploadPieces(
  client: Client<Transport, Chain, Account>,
  options: UploadPiecesOptions
): Promise<UseUploadPiecesResult> {
  const { dataSet, files, metadata, signal } = options
  // `limiter` keeps every parked piece in one window until the explicit close below, so the
  // batch is one add-pieces request even though the uploads are throttled.
  const batcher = SP.createPieceBatcher(client, { dataSet, wait: { kind: 'limiter' } })
  const acquire = createSemaphore(Math.max(1, options.concurrency ?? 4))
  const hashes = new Set<string>()
  const settledParking: Promise<void>[] = []

  const uploads = files.map((file, index) => {
    const pieceMetadata = metadata?.(file)
    const parking = Promise.withResolvers<void>()
    settledParking.push(parking.promise)
    return (async () => {
      const release = await acquire()
      const done = () => {
        release()
        parking.resolve()
      }
      try {
        // `upload()` resolves only after the window is flushed, so free the slot once the piece is parked.
        const result = await batcher.upload({
          data: file,
          metadata: pieceMetadata,
          signal,
          onParked: done,
          onProgress: (bytesUploaded) => options.onFileProgress?.({ file, index, bytesUploaded }),
        })
        if (!hashes.has(result.txHash)) {
          hashes.add(result.txHash)
          options.onHash?.(result.txHash)
        }
        return { file, metadata: pieceMetadata, result }
      } finally {
        done()
      }
    })()
  })

  // Handle failures now: an upload can reject long before the window is flushed.
  const settledUploads = Promise.allSettled(uploads)

  await Promise.all(settledParking)
  // Let the last parked pieces join the window before it is flushed.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await batcher.close()

  const settled = await settledUploads
  const uploaded = settled.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []))
  const failed = settled.flatMap((item, index) =>
    item.status === 'rejected' ? [{ file: files[index], error: toError(item.reason) }] : []
  )
  if (uploaded.length === 0) {
    throw failed[0]?.error ?? new Error('No files to upload')
  }

  const statusUrls = [...new Set(uploaded.map(({ result }) => result.statusUrl))]
  const confirmations = await Promise.all(statusUrls.map((statusUrl) => SP.waitForAddPieces({ statusUrl, signal })))
  const confirmationByUrl = new Map(statusUrls.map((statusUrl, i) => [statusUrl, confirmations[i]]))

  return {
    confirmations,
    pieces: uploaded.map(({ file, metadata, result }) => ({
      file,
      pieceCid: result.pieceCid,
      // The provider confirms piece ids in submission order.
      pieceId: confirmationByUrl.get(result.statusUrl)?.confirmedPieceIds[result.batchIndex],
      size: result.size,
      metadata,
    })),
    failed,
  }
}

/**
 * Create a counting semaphore.
 *
 * @param limit - The maximum number of slots held at the same time.
 * @returns A function that resolves with an idempotent release function once a slot is free.
 */
function createSemaphore(limit: number) {
  let active = 0
  const queue: (() => void)[] = []
  return () =>
    new Promise<() => void>((resolve) => {
      const grant = () => {
        active++
        let released = false
        resolve(() => {
          if (released) {
            return
          }
          released = true
          active--
          queue.shift()?.()
        })
      }
      if (active < limit) {
        grant()
      } else {
        queue.push(grant)
      }
    })
}

/**
 * Normalise a thrown value into an Error.
 *
 * @param error - The thrown value.
 * @returns The error.
 */
function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
