import type {
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  ReadContractErrorType,
  Transport,
} from 'viem'
import { readContract } from 'viem/actions'
import type { storageView as storageViewAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import { type MetadataObject, metadataArrayToObject } from '../utils/metadata.ts'

export namespace getAllPieceMetadata {
  export type OptionsType = {
    /** The ID of the data set the piece belongs to. */
    dataSetId: bigint
    /** The ID of the piece to get metadata for. */
    pieceId: bigint
    /** The address of the storage view contract. If not provided, the default is the storage view contract address for the chain. */
    address?: Address
  }
  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'getAllPieceMetadata'
  >

  export type OutputType = MetadataObject

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

export function formatAllPieceMetadata(data: getAllPieceMetadata.ContractOutputType): MetadataObject {
  return metadataArrayToObject(data)
}

/**
 * Get all metadata for a piece formatted as a MetadataObject
 *
 * @param client - The client to use to get the piece metadata.
 * @param options - {@link getAllPieceMetadata.OptionsType}
 * @returns The metadata formatted as a MetadataObject {@link getAllPieceMetadata.OutputType}
 * @throws Errors {@link getAllPieceMetadata.ErrorType}
 *
 * @example
 * ```ts twoslash
 * import { getAllPieceMetadata } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const metadata = await getAllPieceMetadata(client, {
 *   dataSetId: 1n,
 *   pieceId: 0n,
 * })
 *
 * console.log(metadata)
 * ```
 */
export async function getAllPieceMetadata(
  client: Client<Transport, Chain>,
  options: getAllPieceMetadata.OptionsType
): Promise<getAllPieceMetadata.OutputType> {
  const data = await readContract(
    client,
    getAllPieceMetadataCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      pieceId: options.pieceId,
      address: options.address,
    })
  )
  return formatAllPieceMetadata(data)
}

export namespace getAllPieceMetadataCall {
  export type OptionsType = {
    /** The ID of the data set the piece belongs to. */
    dataSetId: bigint
    /** The ID of the piece to get metadata for. */
    pieceId: bigint
    /** The address of the storage view contract. If not provided, the default is the storage view contract address for the chain. */
    address?: Address
    /** The chain to use to get the piece metadata. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'getAllPieceMetadata'>
}

/**
 * Create a call to the getAllPieceMetadata function
 *
 * This function is used to create a call to the getAllPieceMetadata function for use with the multicall or readContract function.
 *
 * Use {@link formatAllPieceMetadata} to format the output into a MetadataObject.
 *
 * @param options - {@link getAllPieceMetadataCall.OptionsType}
 * @returns The call to the getAllPieceMetadata function {@link getAllPieceMetadataCall.OutputType}
 * @throws Errors {@link getAllPieceMetadataCall.ErrorType}
 *
 * @example
 * ```ts twoslash
 * import { formatAllPieceMetadata, getAllPieceMetadataCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const results = await multicall(client, {
 *   contracts: [
 *     getAllPieceMetadataCall({ chain: calibration, dataSetId: 1n, pieceId: 0n }),
 *     getAllPieceMetadataCall({ chain: calibration, dataSetId: 1n, pieceId: 1n }),
 *   ],
 * })
 *
 * const formattedMetadata = results.map(formatAllPieceMetadata)
 *
 * console.log(formattedMetadata)
 * ```
 */
export function getAllPieceMetadataCall(options: getAllPieceMetadataCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.storageView.abi,
    address: options.address ?? chain.contracts.storageView.address,
    functionName: 'getAllPieceMetadata',
    args: [options.dataSetId, options.pieceId],
  } satisfies getAllPieceMetadataCall.OutputType
}
