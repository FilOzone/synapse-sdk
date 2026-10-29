import * as SP from '@filoz/synapse-core/sp'
import { upload } from '@filoz/synapse-core/sp'
import { getPayerAddress } from '@filoz/synapse-core/utils'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChainId, useConfig, useConnection } from 'wagmi'
import { getSignerClient, type SessionKeySignerOptions } from '../signer.ts'
import type { useUploadPieces } from './use-upload-pieces.ts'

export interface UseUploadSimpleProps extends SessionKeySignerOptions {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  mutation?: Omit<MutateOptions<SP.waitForAddPieces.OutputType, Error, UseUploadSimpleVariables>, 'mutationFn'>
}

export interface UseUploadSimpleVariables {
  files: File[]
  dataSetId: bigint
}
/**
 * Upload files to a data set and add them in one request.
 *
 * @deprecated Use {@link useUploadPieces}, which streams each file, reports progress and returns the files that failed
 * instead of rejecting the whole upload.
 *
 * @param props - The props to use. {@link UseUploadSimpleProps}
 * @returns The upload mutation.
 */
export function useUploadSimple(props: UseUploadSimpleProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const account = useConnection({ config })
  const queryClient = useQueryClient()

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ files, dataSetId }: UseUploadSimpleVariables) => {
      const client = await getSignerClient(config, {
        account: account.address,
        chainId,
        sessionKey: props?.sessionKey,
      })

      const uploadRsp = await upload(client, {
        dataSetId,
        data: files,
      })

      props?.onHash?.(uploadRsp.txHash)
      const rsp = await SP.waitForAddPieces({ client, ...uploadRsp })

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', getPayerAddress(client.account), chainId],
      })
      return rsp
    },
  })
}
