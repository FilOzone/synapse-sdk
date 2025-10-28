import { getChain } from '@filoz/synapse-core/chains'
import type { SessionKey } from '@filoz/synapse-core/session-key'
import type { AddPiecesSuccess } from '@filoz/synapse-core/sp'
import * as SP from '@filoz/synapse-core/sp'
import { upload } from '@filoz/synapse-core/warm-storage'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseUploadProps {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  sessionKey?: SessionKey
  mutation?: Omit<MutateOptions<AddPiecesSuccess, Error, UseUploadVariables>, 'mutationFn'>
}

export interface UseUploadVariables {
  files: File[]
  dataSetId: bigint
}
export function useUpload(props: UseUploadProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  const client = config.getClient()

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ files, dataSetId }: UseUploadVariables) => {
      let connectorClient = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })
      if (props?.sessionKey && (await props?.sessionKey.isValid(connectorClient, 'AddPieces'))) {
        connectorClient = props?.sessionKey.client(chain, client.transport)
      }

      const uploadRsp = await upload(connectorClient, {
        dataSetId,
        data: files,
      })

      props?.onHash?.(uploadRsp.txHash)
      const rsp = await SP.pollForAddPiecesStatus(uploadRsp)

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', account.address],
      })
      return rsp
    },
  })
}
