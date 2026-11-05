import * as SP from '@filoz/synapse-core/sp'
import type { PDPProvider } from '@filoz/synapse-core/sp-registry'
import { getPayerAddress, type MetadataObject } from '@filoz/synapse-core/utils'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getSignerClient, type SessionKeySignerOptions } from '../signer.ts'

export interface UseCreateDataSetProps extends SessionKeySignerOptions {
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
  mutation?: Omit<MutateOptions<SP.waitForCreateDataSet.OutputType, Error, UseCreateDataSetVariables>, 'mutationFn'>
}

export interface UseCreateDataSetVariables {
  /**
   * PDP Provider
   */
  provider: PDPProvider
  cdn: boolean
  /**
   * Data set metadata.
   */
  metadata?: MetadataObject
}

export type UseCreateDataSetResult = SP.waitForCreateDataSet.OutputType

export function useCreateDataSet(props: UseCreateDataSetProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ provider, cdn, metadata }: UseCreateDataSetVariables) => {
      const client = await getSignerClient(config, {
        account: account.address,
        chainId,
        sessionKey: props?.sessionKey,
      })

      const { txHash, extraData } = await SP.createDataSet(client, {
        payee: provider.payee,
        serviceURL: provider.pdp.serviceURL,
        cdn,
        metadata,
      })
      props?.onHash?.(txHash)

      const dataSet = await SP.waitForCreateDataSet({ client, txHash, extraData })

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', getPayerAddress(client.account), chainId],
      })
      return dataSet
    },
  })
}
