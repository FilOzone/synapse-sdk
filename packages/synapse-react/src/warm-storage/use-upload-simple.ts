import * as SP from '@filoz/synapse-core/sp'
import { type AddPiecesSuccess, upload } from '@filoz/synapse-core/sp'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChainId, useConfig, useConnection } from 'wagmi'
import { getSignerClient, type SessionKeySignerOptions } from '../signer.ts'

export interface UseUploadSimpleProps extends SessionKeySignerOptions {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  mutation?: Omit<MutateOptions<AddPiecesSuccess, Error, UseUploadSimpleVariables>, 'mutationFn'>
}

export interface UseUploadSimpleVariables {
  files: File[]
  dataSetId: bigint
}
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
      const rsp = await SP.waitForAddPieces(uploadRsp)

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', props?.sessionKey?.rootAddress ?? account.address, chainId],
      })
      return rsp
    },
  })
}
