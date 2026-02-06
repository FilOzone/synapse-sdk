import * as SP from '@filoz/synapse-core/sp'
import type { PDPProvider } from '@filoz/synapse-core/sp-registry'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseCreateDataSetProps {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  mutation?: Omit<MutateOptions<SP.waitForCreateDataSet.ReturnType, Error, UseCreateDataSetVariables>, 'mutationFn'>
}

export interface UseCreateDataSetVariables {
  /**
   * PDP Provider
   */
  provider: PDPProvider
  cdn: boolean
}

export type UseCreateDataSetResult = SP.waitForCreateDataSet.ReturnType

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

      const { txHash, statusUrl } = await SP.createDataSet(connectorClient, {
        payee: provider.payee,
        payer: account.address,
        serviceURL: provider.pdp.serviceURL,
        cdn,
        // metadata: {
        //   title: 'Test Data Set',
        //   description: 'Test Description',
        // },
      })
      props?.onHash?.(txHash)

      const dataSet = await SP.waitForCreateDataSet({ statusUrl })

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
