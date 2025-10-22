import { getChain } from '@filoz/synapse-core/chains'
import type { AddPiecesSuccess } from '@filoz/synapse-core/curio'
import * as Curio from '@filoz/synapse-core/curio'
import type { SessionKey } from '@filoz/synapse-core/session-key'
import { upload } from '@filoz/synapse-core/warm-storage'
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
  sessionKey?: SessionKey
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
    mutationFn: async ({ files, dataSetId, sessionKey }: UseUploadVariables) => {
      let connectorClient = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })
      if (sessionKey && (await sessionKey.isValid(connectorClient, 'AddPieces'))) {
        connectorClient = sessionKey.client(chain, client.transport)
      }

      const pieces = await upload(connectorClient, {
        dataSetId,
        data: files,
      })

      props?.onHash?.(pieces.txHash)
      const rsp = await Curio.pollForAddPiecesStatus({
        statusUrl: pieces.statusUrl,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', account.address],
      })
      return rsp
    },
  })
}
