import { getPriceList } from '@filoz/synapse-core/warm-storage'
import { type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useConfig } from 'wagmi'

/**
 * The result for the usePriceList hook.
 */
export type UsePriceListResult = getPriceList.OutputType

/**
 * The props for the usePriceList hook.
 */
export interface UsePriceListProps {
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

  return useQuery({
    ...props?.query,
    queryKey: ['synapse-warm-storage-get-price-list', config.getClient().chain.id],
    queryFn: async () => {
      const result = await getPriceList(config.getClient())
      return result
    },
  })
}
