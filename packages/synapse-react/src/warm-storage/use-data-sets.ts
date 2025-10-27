import { type MetadataObject, metadataArrayToObject } from '@filoz/synapse-core'
import { getChain } from '@filoz/synapse-core/chains'
import type { CurioPieceWithUrl } from '@filoz/synapse-core/curio'
import * as PDP from '@filoz/synapse-core/curio'
import { type DataSet, getDataSets, readProviders } from '@filoz/synapse-core/warm-storage'
import { skipToken, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import type { Simplify } from 'type-fest'
import type { Address } from 'viem'
import { readContract } from 'viem/actions'
import { useChainId, useConfig } from 'wagmi'
import { useProviders } from './use-providers.ts'

export type PieceWithMetadata = Simplify<CurioPieceWithUrl & { metadata: MetadataObject }>

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
  const { data: providersPrefected } = useProviders()
  const chain = getChain(chainId)
  return useQuery({
    queryKey: ['synapse-warm-storage-data-sets', address],
    queryFn: address
      ? async () => {
          const providers = providersPrefected ?? (await readProviders(config.getClient()))
          const dataSets = await getDataSets(config.getClient(), { address })
          const dataSetsWithPieces = await Promise.all(
            dataSets.map(async (dataSet) => {
              // TODO: Get the active pieces from the PDP contract instead of the Curio API
              const pieces = await PDP.getPiecesForDataSet({
                endpoint: providers.find((p) => p.providerId === dataSet.providerId)?.pdp.serviceURL || '',
                dataSetId: dataSet.pdpDatasetId,
                chainId,
                address,
                cdn: dataSet.cdn,
              })

              const piecesWithMetadata = await Promise.all(
                pieces.map(async (piece) => {
                  const metadata = await readContract(config.getClient(), {
                    address: chain.contracts.storageView.address,
                    abi: chain.contracts.storageView.abi,
                    functionName: 'getAllPieceMetadata',
                    args: [dataSet.pdpDatasetId, BigInt(piece.pieceId)],
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
