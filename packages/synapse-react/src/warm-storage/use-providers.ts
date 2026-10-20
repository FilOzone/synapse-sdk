import { getApprovedPDPProviders } from '@filoz/synapse-core/sp-registry'
import { type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useChainId, useConfig } from 'wagmi'

export interface UseProvidersProps {
  /**
   * The chain id to read from. If not provided, the connected chain will be used.
   */
  chainId?: number
  query?: Omit<UseQueryOptions<UseProvidersResult>, 'queryKey' | 'queryFn'>
}

export type UseProvidersResult = getApprovedPDPProviders.OutputType

export function useProviders(props?: UseProvidersProps) {
  const config = useConfig()
  const connectedChainId = useChainId({ config })
  const chainId = props?.chainId ?? connectedChainId

  return useQuery({
    ...props?.query,
    queryKey: ['synapse-warm-storage-providers', chainId],
    queryFn: () => {
      return getApprovedPDPProviders(config.getClient({ chainId }))
    },
  })
}
