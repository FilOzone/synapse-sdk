import { PDPProviderUnavailableError } from '@filoz/synapse-core/errors'
import * as SP from '@filoz/synapse-core/sp'
import { getPayerAddress } from '@filoz/synapse-core/utils'
import type { PdpDataSet } from '@filoz/synapse-core/warm-storage'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TransactionReceipt } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getSignerClient, type SessionKeySignerOptions } from '../signer.ts'

export interface UseDeletePieceProps extends SessionKeySignerOptions {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  mutation?: Omit<MutateOptions<TransactionReceipt, Error, UseDeletePieceVariables>, 'mutationFn'>
}

export interface UseDeletePieceVariables {
  dataSet: PdpDataSet
  pieceId: bigint
}
export function useDeletePiece(props: UseDeletePieceProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const account = useAccount({ config })
  const queryClient = useQueryClient()

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ dataSet, pieceId }: UseDeletePieceVariables) => {
      if (dataSet.provider == null) {
        throw new PDPProviderUnavailableError(dataSet.providerId)
      }
      const client = await getSignerClient(config, {
        account: account.address,
        chainId,
        sessionKey: props?.sessionKey,
      })

      const deletePieceRsp = await SP.schedulePieceDeletion(client, {
        serviceURL: dataSet.provider.pdp.serviceURL,
        dataSetId: dataSet.dataSetId,
        clientDataSetId: dataSet.clientDataSetId,
        pieceId,
      })

      props?.onHash?.(deletePieceRsp.hash)
      const rsp = await waitForTransactionReceipt(client, deletePieceRsp)

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', getPayerAddress(client.account), chainId],
      })
      return rsp
    },
  })
}
