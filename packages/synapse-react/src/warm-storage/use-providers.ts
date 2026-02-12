import { getApprovedPDPProviders } from '@filoz/synapse-core/sp-registry'
import { type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useConfig } from 'wagmi'

export interface UseProvidersProps {
  query?: Omit<UseQueryOptions<UseProvidersResult>, 'queryKey' | 'queryFn'>
}

export type UseProvidersResult = getApprovedPDPProviders.OutputType

export function useProviders(props?: UseProvidersProps) {
  const config = useConfig()

  return useQuery({
    ...props?.query,
    queryKey: ['synapse-warm-storage-providers', config.getClient().chain.id],
    queryFn: () => {
      return getApprovedPDPProviders(config.getClient())
    },
  })
}
