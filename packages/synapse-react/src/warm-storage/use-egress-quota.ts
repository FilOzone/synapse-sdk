import { getChain } from '@filoz/synapse-core/chains'
import { type DataSetStats, getDataSetStats } from '@filoz/synapse-core/filbeam'
import { skipToken, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useChainId } from 'wagmi'

export type { DataSetStats }

/**
 * The props for the useEgressQuota hook.
 */
export interface UseEgressQuotaProps {
  /** The data set ID to query egress quota for */
  dataSetId?: bigint
  query?: Omit<UseQueryOptions<DataSetStats>, 'queryKey' | 'queryFn'>
}

/**
 * The result for the useEgressQuota hook.
 */
export type UseEgressQuotaResult = DataSetStats

/**
 * Get the egress quota for a data set from FilBeam.
 *
 * @param props - The props to use.
 * @returns The egress quota for the data set.
 *
 * @example
 * ```tsx
 * const { data: egressQuota, isLoading } = useEgressQuota({ dataSetId: 123n })
 * if (egressQuota) {
 *   console.log(`CDN Egress: ${egressQuota.cdnEgressQuota}`)
 *   console.log(`Cache Miss Egress: ${egressQuota.cacheMissEgressQuota}`)
 * }
 * ```
 */
export function useEgressQuota(props: UseEgressQuotaProps) {
  const chainId = useChainId()
  const chain = getChain(chainId)
  const dataSetId = props.dataSetId

  return useQuery({
    ...props.query,
    queryKey: ['synapse-filbeam-egress-quotas', chainId, dataSetId?.toString()],
    queryFn: dataSetId != null ? () => getDataSetStats({ chain, dataSetId }) : skipToken,
  })
}
