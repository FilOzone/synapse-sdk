import type { Account, Chain, Client, Transport } from 'viem'
import type { PieceCID } from '../piece/piece-cid.ts'
import type { MetadataObject } from '../utils/metadata.ts'
import type { PdpDataSet } from '../warm-storage/types.ts'
import { waitForAddPieces } from './add-pieces.ts'
import type { Limiter } from './add-pieces-fits.ts'
import { createPieceBatcher, type UploadInput } from './create-piece-batcher.ts'

export namespace uploadPieces {
  export type InputPiece = {
    /** The data to upload. */
    data: UploadInput['data']
    /** Known length for a stream (`File` and `Uint8Array` use their own size). */
    size?: number
    /** The piece metadata. */
    metadata?: MetadataObject
  }
  export type OptionsType = {
    /** The data set to add the pieces to. */
    dataSet: PdpDataSet
    /** The pieces to upload. Each becomes one piece in the data set. */
    pieces: InputPiece[]
    /** Maximum number of pieces streamed to the provider at the same time. Defaults to 4. */
    concurrency?: number
    /** Decides whether pieces still fit in one add-pieces request. Defaults to `addPiecesFits`. */
    limiter?: Limiter
    /** Called as a piece makes upload progress. */
    onProgress?: (index: number, bytesUploaded: number) => void
    /** Called once per add-pieces transaction hash. */
    onHash?: (txHash: string) => void
    /** The signal to abort the uploads and the confirmation wait. */
    signal?: AbortSignal
  }
  export type UploadedPiece = {
    /** The index of the piece in `pieces`. */
    index: number
    /** The PieceCID. */
    pieceCid: PieceCID
    /** The piece id in the data set, from the confirmed add-pieces transaction. */
    pieceId: bigint | undefined
    /** The raw size of the piece in bytes. */
    size: number
    /** The metadata stored with the piece. */
    metadata: MetadataObject | undefined
  }
  export type OutputType = {
    /**
     * The provider confirmations of the add-pieces transactions, one per transaction.
     * All pieces go in one transaction unless they don't fit in a single add-pieces request.
     */
    confirmations: waitForAddPieces.OutputType[]
    /** The pieces added to the data set, in input order. */
    pieces: UploadedPiece[]
    /** The pieces that failed to upload or whose add-pieces transaction was not confirmed. */
    failed: { index: number; error: Error }[]
  }
}

/**
 * Upload pieces to an existing data set and add them in one signed request.
 *
 * Streams each piece to the data set's provider (`concurrency` at a time), then adds every parked piece in one
 * add-pieces request and waits for it to be confirmed. Pieces that fail to upload, or whose add-pieces transaction is
 * not confirmed, are returned in `failed`; the others are still added. Throws when no piece could be uploaded and added.
 *
 * @param client - The client to sign with.
 * @param options - {@link uploadPieces.OptionsType}
 * @returns The confirmations, the added pieces and the failed ones. {@link uploadPieces.OutputType}
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 *
 * const { pieces, failed } = await SP.uploadPieces(client, {
 *   dataSet,
 *   pieces: files.map((file) => ({ data: file, metadata: { name: file.name } })),
 * })
 * ```
 */
export async function uploadPieces(
  client: Client<Transport, Chain, Account>,
  options: uploadPieces.OptionsType
): Promise<uploadPieces.OutputType> {
  // `limiter` keeps every parked piece in one window until `close()`, so the batch is one add-pieces request.
  const batcher = createPieceBatcher(client, {
    dataSet: options.dataSet,
    wait: { kind: 'limiter' },
    concurrency: options.concurrency ?? 4,
    limiter: options.limiter,
  })
  const hashes = new Set<string>()
  const uploads = options.pieces.map(async (piece, index) => {
    const result = await batcher.upload({
      data: piece.data,
      size: piece.size,
      metadata: piece.metadata,
      signal: options.signal,
      onProgress: (bytesUploaded) => options.onProgress?.(index, bytesUploaded),
    })
    if (!hashes.has(result.txHash)) {
      hashes.add(result.txHash)
      options.onHash?.(result.txHash)
    }
    return result
  })
  // Attach handlers now: an upload can reject long before the window is flushed.
  const settledUploads = Promise.allSettled(uploads)
  await batcher.close()
  const settled = await settledUploads

  const failed = settled.flatMap((item, index) =>
    item.status === 'rejected' ? [{ index, error: toError(item.reason) }] : []
  )
  const uploaded = settled.flatMap((item, index) =>
    item.status === 'fulfilled' ? [{ index, metadata: options.pieces[index]?.metadata, result: item.value }] : []
  )

  // A failed confirmation only fails its own transaction's pieces; the others keep their piece ids.
  const statusUrls = [...new Set(uploaded.map(({ result }) => result.statusUrl))]
  const settledConfirmations = await Promise.allSettled(
    statusUrls.map((statusUrl) => waitForAddPieces({ statusUrl, signal: options.signal }))
  )
  const confirmationByUrl = new Map<string, waitForAddPieces.OutputType>()
  const errorByUrl = new Map<string, Error>()
  settledConfirmations.forEach((item, i) => {
    const statusUrl = statusUrls[i] as string
    if (item.status === 'fulfilled') {
      confirmationByUrl.set(statusUrl, item.value)
    } else {
      errorByUrl.set(statusUrl, toError(item.reason))
    }
  })

  const pieces: uploadPieces.UploadedPiece[] = []
  for (const { index, metadata, result } of uploaded) {
    const error = errorByUrl.get(result.statusUrl)
    if (error != null) {
      failed.push({ index, error })
      continue
    }
    pieces.push({
      index,
      pieceCid: result.pieceCid,
      // The provider confirms piece ids in submission order.
      pieceId: confirmationByUrl.get(result.statusUrl)?.confirmedPieceIds[result.batchIndex],
      size: result.size,
      metadata,
    })
  }
  failed.sort((a, b) => a.index - b.index)
  if (pieces.length === 0) {
    throw failed[0]?.error ?? new Error('No pieces to upload.')
  }

  return {
    confirmations: [...confirmationByUrl.values()],
    pieces,
    failed,
  }
}

/**
 * Normalise a thrown value into an Error.
 *
 * @param error - The thrown value.
 * @returns The error.
 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
