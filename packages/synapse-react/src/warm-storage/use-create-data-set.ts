import type { DataSetCreatedResponse } from '@filoz/synapse-core/sp'
import * as SP from '@filoz/synapse-core/sp'
import { createDataSet, type PDPProvider } from '@filoz/synapse-core/warm-storage'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseCreateDataSetProps {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  mutation?: Omit<MutateOptions<DataSetCreatedResponse, Error, UseCreateDataSetVariables>, 'mutationFn'>
}

export interface UseCreateDataSetVariables {
  /**
   * PDP Provider
   */
  provider: PDPProvider
  cdn: boolean
}

export type UseCreateDataSetResult = DataSetCreatedResponse

export function useCreateDataSet(props: UseCreateDataSetProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ provider, cdn }: UseCreateDataSetVariables) => {
      const connectorClient = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      const { txHash, statusUrl } = await createDataSet(connectorClient, {
        payee: provider.payee,
        payer: account.address,
        endpoint: provider.pdp.serviceURL,
        cdn,
        // metadata: {
        //   title: 'Test Data Set',
        //   description: 'Test Description',
        // },
      })
      props?.onHash?.(txHash)

      const dataSet = await SP.pollForDataSetCreationStatus({ statusUrl })

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', account.address],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-providers-with-data-sets', account.address],
      })
      return dataSet
    },
  })
}
