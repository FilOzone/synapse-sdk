import { getServicePrice } from '@filoz/synapse-core/warm-storage'
import { type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useConfig } from 'wagmi'

/**
 * The result for the useServicePrice hook.
 */
export type UseServicePriceResult = getServicePrice.OutputType

/**
 * The props for the useServicePrice hook.
 */
export interface UseServicePriceProps {
  query?: Omit<UseQueryOptions<UseServicePriceResult>, 'queryKey' | 'queryFn'>
}

/**
 * Get the service price for the warm storage.
 *
 * @param props - The props to use.
 * @returns The service price.
 */
export function useServicePrice(props?: UseServicePriceProps) {
  const config = useConfig()

  return useQuery({
    ...props?.query,
    queryKey: ['synapse-warm-storage-get-service-price', config.getClient().chain.id],
    queryFn: async () => {
      const result = await getServicePrice(config.getClient())
      return result
    },
  })
}
