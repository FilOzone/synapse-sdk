import { getChain } from '@filoz/synapse-core/chains'
import type { SessionKey } from '@filoz/synapse-core/session-key'
import { type DataSet, deletePiece, pollForDeletePieceStatus } from '@filoz/synapse-core/warm-storage'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TransactionReceipt } from 'viem'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseDeletePieceProps {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  sessionKey?: SessionKey
  mutation?: Omit<MutateOptions<TransactionReceipt, Error, UseDeletePieceVariables>, 'mutationFn'>
}

export interface UseDeletePieceVariables {
  dataSet: DataSet
  pieceId: bigint
}
export function useDeletePiece(props: UseDeletePieceProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  const client = config.getClient()

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ dataSet, pieceId }: UseDeletePieceVariables) => {
      let connectorClient = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      if (props?.sessionKey && (await props?.sessionKey.isValid(connectorClient, 'SchedulePieceRemovals'))) {
        connectorClient = props?.sessionKey.client(chain, client.transport)
      }

      const deletePieceRsp = await deletePiece(connectorClient, {
        endpoint: dataSet.pdp.serviceURL,
        dataSetId: dataSet.dataSetId,
        clientDataSetId: dataSet.clientDataSetId,
        pieceId,
      })

      props?.onHash?.(deletePieceRsp.txHash)
      const rsp = await pollForDeletePieceStatus(client, deletePieceRsp)

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', account.address],
      })
      return rsp
    },
  })
}
