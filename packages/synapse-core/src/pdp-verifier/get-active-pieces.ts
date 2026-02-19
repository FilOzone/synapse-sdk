import type { Simplify } from 'type-fest'
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
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import { hexToPieceCID, type PieceCID } from '../piece/piece.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getActivePieces {
  export type OptionsType = {
    /** The ID of the data set to get active pieces for. */
    dataSetId: bigint
    /** The offset for pagination. @default 0n */
    offset?: bigint
    /** The limit for pagination. @default 100n */
    limit?: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = {
    pieces: { cid: PieceCID; id: bigint }[]
    hasMore: boolean
  }
  /**
   * `[piecesData, pieceIds, hasMore]`
   * - `piecesData`: CID bytes encoded as hex strings
   * - `pieceIds`: Piece IDs
   * - `hasMore`: Whether there are more pieces to fetch
   */
  export type ContractOutputType = ContractFunctionReturnType<typeof pdpVerifierAbi, 'pure' | 'view', 'getActivePieces'>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get active pieces for a data set with pagination does NOT account for removals
 *
 * @example
 * ```ts
 * import { getActivePieces } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const [piecesData, pieceIds, hasMore] = await getActivePieces(client, {
 *   dataSetId: 1n,
 * })
 * ```
 *
 * @param client - The client to use to get the active pieces.
 * @param options - {@link getActivePieces.OptionsType}
 * @returns The active pieces for the data set {@link getActivePieces.OutputType}
 * @throws Errors {@link getActivePieces.ErrorType}
 */
export async function getActivePieces(
  client: Client<Transport, Chain>,
  options: getActivePieces.OptionsType
): Promise<getActivePieces.OutputType> {
  const data = await readContract(
    client,
    getActivePiecesCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      offset: options.offset,
      limit: options.limit,
      contractAddress: options.contractAddress,
    })
  )
  return parseActivePieces(data)
}

export namespace getActivePiecesCall {
  export type OptionsType = Simplify<getActivePieces.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getActivePieces'>
}

/**
 * Create a call to the {@link getActivePieces} function for use with the multicall or readContract function.
 *
 * Use {@link parseActivePieces} to parse the contract output into a {@link getActivePieces.OutputType}.
 *
 * @example
 * ```ts
 * import { getActivePiecesCall } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const results = await multicall(client, {
 *   contracts: [
 *     getActivePiecesCall({ chain: calibration, dataSetId: 1n, offset: 0n, limit: 100n }),
 *     getActivePiecesCall({ chain: calibration, dataSetId: 1n, offset: 100n, limit: 100n }),
 *   ],
 * })
 * ```
 *
 * @param options - {@link getActivePiecesCall.OptionsType}
 * @returns The call to the getActivePieces function {@link getActivePiecesCall.OutputType}
 * @throws Errors {@link getActivePiecesCall.ErrorType}
 */
export function getActivePiecesCall(options: getActivePiecesCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getActivePieces',
    args: [options.dataSetId, options.offset ?? 0n, options.limit ?? 100n],
  } satisfies getActivePiecesCall.OutputType
}

/**
 * Parse the contract output into a {@link getActivePieces.OutputType}.
 *
 * @param data - The contract output from the getActivePieces function {@link getActivePieces.ContractOutputType}
 * @returns The active pieces for the data set {@link getActivePieces.OutputType}
 */
export function parseActivePieces(data: getActivePieces.ContractOutputType): getActivePieces.OutputType {
  return {
    pieces: data[0].map((piece, index) => ({
      cid: hexToPieceCID(piece.data),
      id: data[1][index],
    })),
    hasMore: data[2],
  }
}
