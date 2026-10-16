import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChainId, useConfig, useConnection } from 'wagmi'
import { getSignerClient, type SessionKeySignerOptions } from '../signer.ts'
import {
  type UploadPiecesFileProgress,
  type UseUploadPiecesResult,
  type UseUploadPiecesVariables,
  uploadPieces,
} from './upload-pieces.ts'

export type {
  UploadedPiece,
  UploadPiecesFileProgress,
  UseUploadPiecesResult,
  UseUploadPiecesVariables,
} from './upload-pieces.ts'

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
 * Upload files to an existing data set with synapse-core only.
 *
 * Each file is streamed to the data set's provider, which computes its PieceCID. Once every file is parked on the
 * provider (or has failed), all parked pieces are added to the data set in one signed add-pieces request, and the
 * hook waits for the transaction to be confirmed. Files that fail are returned in `failed`; the others are still added.
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

      const result = await uploadPieces(client, {
        dataSet,
        files,
        metadata,
        signal,
        concurrency: props?.concurrency,
        onFileProgress: props?.onFileProgress,
        onHash: props?.onHash,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', props?.sessionKey?.rootAddress ?? account.address, chainId],
      })
      return result
    },
  })
}
