import { getChain } from '@filoz/synapse-core/chains'
import type { SessionKey } from '@filoz/synapse-core/session-key'
import { type DataSet, deletePieces, waitForDeletePieceStatus } from '@filoz/synapse-core/warm-storage'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TransactionReceipt } from 'viem'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseDeletePiecesProps {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  sessionKey?: SessionKey
  mutation?: Omit<MutateOptions<TransactionReceipt, Error, UseDeletePiecesVariables>, 'mutationFn'>
}

export interface UseDeletePiecesVariables {
  dataSet: DataSet
  pieceIds: bigint[]
}

/**
 * Hook to delete multiple pieces from a data set.
 *
 * @param props - {@link UseDeletePiecesProps}
 * @returns
 */
export function useDeletePieces(props: UseDeletePiecesProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  const client = config.getClient()

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ dataSet, pieceIds }: UseDeletePiecesVariables) => {
      let connectorClient = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      if (props?.sessionKey && (await props?.sessionKey.isValid(connectorClient, 'SchedulePieceRemovals'))) {
        connectorClient = props?.sessionKey.client(chain, client.transport)
      }

      const deletePiecesRsp = await deletePieces(connectorClient, {
        endpoint: dataSet.pdp.serviceURL,
        dataSetId: dataSet.dataSetId,
        clientDataSetId: dataSet.clientDataSetId,
        pieceIds,
      })

      props?.onHash?.(deletePiecesRsp.txHash)
      const rsp = await waitForDeletePieceStatus(client, deletePiecesRsp)

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', account.address],
      })
      return rsp
    },
  })
}
