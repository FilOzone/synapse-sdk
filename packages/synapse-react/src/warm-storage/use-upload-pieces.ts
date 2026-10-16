import type { PieceCID } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import type { MetadataObject } from '@filoz/synapse-core/utils'
import type { PdpDataSet } from '@filoz/synapse-core/warm-storage'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChainId, useConfig, useConnection } from 'wagmi'
import { getSignerClient, type SessionKeySignerOptions } from '../signer.ts'

/**
 * Progress of one file in {@link useUploadPieces}.
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
 * A piece uploaded and added to the data set by {@link useUploadPieces}.
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
 * The props for the useUploadPieces hook.
 */
export interface UseUploadPiecesProps extends SessionKeySignerOptions {
  /**
   * The maximum number of files streamed to the provider at the same time.
   *
   * @default 4
   */
  concurrency?: number
  /**
   * The callback to call when a file makes upload progress.
   */
  onFileProgress?: (progress: UploadPiecesFileProgress) => void
  /**
   * The callback to call when an add-pieces transaction hash is available.
   */
  onHash?: (hash: string) => void
  /**
   * The mutation options.
   */
  mutation?: Omit<MutateOptions<UseUploadPiecesResult, Error, UseUploadPiecesVariables>, 'mutationFn'>
}

/**
 * Upload files to an existing data set with synapse-core only (`SP.uploadPieces`).
 *
 * Each file is streamed to the data set's provider, which computes its PieceCID. All parked pieces are added to the
 * data set in one signed add-pieces request, and the hook waits for the transaction to be confirmed. Files that fail
 * are returned in `failed`; the others are still added.
 *
 * Signs with `sessionKey` when given, otherwise with the connected wallet.
 *
 * @param props - The props to use. {@link UseUploadPiecesProps}
 * @returns The upload mutation. {@link UseUploadPiecesResult}
 */
export function useUploadPieces(props?: UseUploadPiecesProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const account = useConnection({ config })
  const queryClient = useQueryClient()

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ dataSet, files, metadata, signal }: UseUploadPiecesVariables) => {
      const client = await getSignerClient(config, {
        account: account.address,
        chainId,
        sessionKey: props?.sessionKey,
      })

      const result = await SP.uploadPieces(client, {
        dataSet,
        pieces: files.map((file) => ({ data: file, metadata: metadata?.(file) })),
        concurrency: props?.concurrency,
        signal,
        onHash: props?.onHash,
        onProgress: (index, bytesUploaded) => props?.onFileProgress?.({ file: files[index], index, bytesUploaded }),
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', props?.sessionKey?.rootAddress ?? account.address, chainId],
      })
      return {
        confirmations: result.confirmations,
        pieces: result.pieces.map(({ index, ...piece }) => ({ ...piece, file: files[index] })),
        failed: result.failed.map(({ index, error }) => ({ file: files[index], error })),
      }
    },
  })
}
