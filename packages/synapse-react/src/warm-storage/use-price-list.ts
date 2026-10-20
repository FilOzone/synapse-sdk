import { getPriceList } from '@filoz/synapse-core/warm-storage'
import { type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useChainId, useConfig } from 'wagmi'

/**
 * The result for the usePriceList hook.
 */
export type UsePriceListResult = getPriceList.OutputType

/**
 * The props for the usePriceList hook.
 */
export interface UsePriceListProps {
  /**
   * The chain id to read from. If not provided, the connected chain will be used.
   */
  chainId?: number
  query?: Omit<UseQueryOptions<UsePriceListResult>, 'queryKey' | 'queryFn'>
}

/**
 * Get the warm storage price list.
 *
 * @param props - The props to use.
 * @returns The price list.
 */
export function usePriceList(props?: UsePriceListProps) {
  const config = useConfig()
  const connectedChainId = useChainId({ config })
  const chainId = props?.chainId ?? connectedChainId

  return useQuery({
    ...props?.query,
    queryKey: ['synapse-warm-storage-get-price-list', chainId],
    queryFn: async () => {
      const result = await getPriceList(config.getClient({ chainId }))
      return result
    },
  })
}
