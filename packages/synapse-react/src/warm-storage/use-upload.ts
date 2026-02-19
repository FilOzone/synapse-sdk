import * as SP from '@filoz/synapse-core/sp'
import { type AddPiecesSuccess, upload } from '@filoz/synapse-core/sp'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseUploadProps {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  mutation?: Omit<MutateOptions<AddPiecesSuccess, Error, UseUploadVariables>, 'mutationFn'>
}

export interface UseUploadVariables {
  files: File[]
  dataSetId: bigint
}
export function useUpload(props: UseUploadProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const account = useAccount({ config })
  const queryClient = useQueryClient()

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ files, dataSetId }: UseUploadVariables) => {
      const connectorClient = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      const uploadRsp = await upload(connectorClient, {
        dataSetId,
        data: files,
      })

      props?.onHash?.(uploadRsp.txHash)
      const rsp = await SP.waitForAddPieces(uploadRsp)

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', account.address, config.getClient().chain.id],
      })
      return rsp
    },
  })
}
