import { paginate } from '@filoz/synapse-core'
import { getPieces } from '@filoz/synapse-core/pdp-verifier'
import { getPdpDataSets, type PdpDataSet, type Piece } from '@filoz/synapse-core/warm-storage'
import { skipToken, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useChainId, useConfig } from 'wagmi'

export interface DataSetWithPieces extends PdpDataSet {
  pieces: Piece[]
}

/**
 * The result for the useDataSets hook: data sets with their pieces, or without them when `includePieces` is `false`.
 */
export type UseDataSetsResult<IncludePieces extends boolean = true> = IncludePieces extends false
  ? PdpDataSet[]
  : DataSetWithPieces[]

export interface UseDataSetsProps<IncludePieces extends boolean = true> {
  address?: Address
  /**
   * The chain id to read from. If not provided, the connected chain will be used.
   */
  chainId?: number
  /**
   * Whether to load the pieces of every data set. Each data set costs at least one extra RPC call.
   * Set it to `false` for list views that only need the data sets (`hasActivePieces` tells whether a data set has pieces).
   *
   * @default true
   */
  includePieces?: IncludePieces
  query?: Omit<UseQueryOptions<UseDataSetsResult<IncludePieces>>, 'queryKey' | 'queryFn'>
}

/**
 * Maximum number of data sets whose pieces are loaded at the same time.
 */
const PIECES_CONCURRENCY = 4

/**
 * Get the data sets of an address, optionally with their pieces.
 *
 * @param props - The props to use. {@link UseDataSetsProps}
 * @returns The data sets. {@link UseDataSetsResult}
 */
export function useDataSets<IncludePieces extends boolean = true>(props: UseDataSetsProps<IncludePieces>) {
  const config = useConfig()
  const connectedChainId = useChainId({ config })
  const chainId = props.chainId ?? connectedChainId
  const address = props.address
  const includePieces = props.includePieces ?? true
  return useQuery({
    ...props.query,
    queryKey: ['synapse-warm-storage-data-sets', address, chainId, includePieces],
    queryFn: address
      ? async () => {
          const client = config.getClient({ chainId })
          const dataSets = await Array.fromAsync(paginate(({ cursor }) => getPdpDataSets(client, { address, cursor })))
          if (!includePieces) {
            return dataSets as UseDataSetsResult<IncludePieces>
          }
          const dataSetsWithPieces = await mapWithLimit(dataSets, PIECES_CONCURRENCY, async (dataSet) => {
            const pieces = await Array.fromAsync(
              paginate(({ cursor }) =>
                getPieces(client, {
                  dataSet,
                  address,
                  cursor,
                })
              )
            )

            return {
              ...dataSet,
              pieces,
            }
          })
          return dataSetsWithPieces as UseDataSetsResult<IncludePieces>
        }
      : skipToken,
  })
}

/**
 * Like `Promise.all(items.map(fn))`, but runs at most `limit` calls at a time.
 *
 * @param items - The inputs.
 * @param limit - The maximum number of concurrent calls.
 * @param fn - The async work per item.
 * @returns The results, in input order.
 */
async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
