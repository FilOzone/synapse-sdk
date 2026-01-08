import { getChain } from '@filoz/synapse-core/chains'
import { type MetadataObject, metadataArrayToObject } from '@filoz/synapse-core/utils'
import { type DataSet, getDataSets, getPieces, type Piece } from '@filoz/synapse-core/warm-storage'
import { skipToken, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import type { Simplify } from 'type-fest'
import type { Address } from 'viem'
import { readContract } from 'viem/actions'
import { useChainId, useConfig } from 'wagmi'

export type PieceWithMetadata = Simplify<Piece & { metadata: MetadataObject }>

export interface DataSetEgressQuota {
  cdnEgressQuota: bigint
  cacheMissEgressQuota: bigint
}

export interface DataSetWithPieces extends DataSet {
  pieces: PieceWithMetadata[]
  egressQuota?: DataSetEgressQuota
}

function getFilBeamStatsBaseUrl(chainId: number): string {
  return chainId === 314 ? 'https://stats.filbeam.com' : 'https://calibration.stats.filbeam.com'
}

async function fetchDataSetEgressQuota(chainId: number, dataSetId: bigint): Promise<DataSetEgressQuota | undefined> {
  const baseUrl = getFilBeamStatsBaseUrl(chainId)
  const url = `${baseUrl}/data-set/${dataSetId}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`Failed to fetch data set egress quota: ${response.status} ${response.statusText}`)
      return undefined
    }

    const data = (await response.json()) as Record<string, unknown>

    if (typeof data.cdnEgressQuota !== 'string' || typeof data.cacheMissEgressQuota !== 'string') {
      console.error('Unexpected response body from FilBeam Stats API:', data)
      return undefined
    }

    return {
      cdnEgressQuota: BigInt(data.cdnEgressQuota),
      cacheMissEgressQuota: BigInt(data.cacheMissEgressQuota),
    }
  } catch (err) {
    console.error('Cannot fetch data set egress quotas from FilBeam Stats API', err)
    return undefined
  }
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

              const egressQuota = dataSet.cdn ? await fetchDataSetEgressQuota(chainId, dataSet.dataSetId) : undefined

              return {
                ...dataSet,
                pieces: piecesWithMetadata,
                egressQuota,
              }
            })
          )
          return dataSetsWithPieces
        }
      : skipToken,
  })
}
