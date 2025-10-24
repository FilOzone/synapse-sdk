import { type MetadataObject, metadataArrayToObject } from '@filoz/synapse-core'
import { getChain } from '@filoz/synapse-core/chains'
import { type DataSet, getDataSets, getPieces, type Piece } from '@filoz/synapse-core/warm-storage'
import { skipToken, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import type { Simplify } from 'type-fest'
import type { Address } from 'viem'
import { readContract } from 'viem/actions'
import { useChainId, useConfig } from 'wagmi'

export type PieceWithMetadata = Simplify<Piece & { metadata: MetadataObject }>

export interface DataSetWithPieces extends DataSet {
  pieces: PieceWithMetadata[]
}

export type UseDataSetsResult = DataSetWithPieces[]

export interface UseDataSetsProps {
  address?: Address
  query?: Omit<UseQueryOptions<UseDataSetsResult>, 'queryKey' | 'queryFn'>
}

export function useDataSets(props: UseDataSetsProps) {
  const config = useConfig()
  const chainId = useChainId()
  const address = props.address
  const chain = getChain(chainId)
  return useQuery({
    queryKey: ['synapse-warm-storage-data-sets', address],
    queryFn: address
      ? async () => {
          const dataSets = await getDataSets(config.getClient(), { address })
          const dataSetsWithPieces = await Promise.all(
            dataSets.map(async (dataSet) => {
              const piecesPaginated = await getPieces(config.getClient(), {
                dataSet,
                address,
              })

              const piecesWithMetadata = await Promise.all(
                piecesPaginated.pieces.map(async (piece) => {
                  const metadata = await readContract(config.getClient(), {
                    address: chain.contracts.storageView.address,
                    abi: chain.contracts.storageView.abi,
                    functionName: 'getAllPieceMetadata',
                    args: [dataSet.dataSetId, BigInt(piece.id)],
                  })
                  return {
                    ...piece,
                    metadata: metadataArrayToObject(metadata),
                  }
                })
              )

              return {
                ...dataSet,
                pieces: piecesWithMetadata,
              }
            })
          )
          return dataSetsWithPieces
        }
      : skipToken,
  })
}
