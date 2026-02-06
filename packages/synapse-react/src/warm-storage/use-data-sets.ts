import { getPiecesWithMetadata } from '@filoz/synapse-core/pdp-verifier'
import { getPdpDataSets, type PdpDataSet, type PieceWithMetadata } from '@filoz/synapse-core/warm-storage'
import { skipToken, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useConfig } from 'wagmi'

export interface DataSetWithPieces extends PdpDataSet {
  pieces: PieceWithMetadata[]
}

export type UseDataSetsResult = DataSetWithPieces[]

export interface UseDataSetsProps {
  address?: Address
  query?: Omit<UseQueryOptions<UseDataSetsResult>, 'queryKey' | 'queryFn'>
}

export function useDataSets(props: UseDataSetsProps) {
  const config = useConfig()
  const address = props.address
  return useQuery({
    queryKey: ['synapse-warm-storage-data-sets', address],
    queryFn: address
      ? async () => {
          const dataSets = await getPdpDataSets(config.getClient(), { client: address })
          const dataSetsWithPieces = await Promise.all(
            dataSets.map(async (dataSet) => {
              const result = await getPiecesWithMetadata(config.getClient(), {
                dataSet,
                address,
              })

              return {
                ...dataSet,
                pieces: result.pieces,
              }
            })
          )
          return dataSetsWithPieces
        }
      : skipToken,
  })
}
