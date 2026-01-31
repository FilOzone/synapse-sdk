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

  /**
   * `[piecesData, pieceIds, hasMore]`
   * - `piecesData`: CID bytes encoded as hex strings
   * - `pieceIds`: Piece IDs
   * - `hasMore`: Whether there are more pieces to fetch
   */
  export type OutputType = readonly [
    pieceData: readonly { data: `0x${string}` }[],
    pieceIds: readonly bigint[],
    hasMore: boolean,
  ]
  export type ContractOutputType = ContractFunctionReturnType<typeof pdpVerifierAbi, 'pure' | 'view', 'getActivePieces'>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get active pieces for a data set with pagination
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
  const [piecesData, pieceIds, hasMore] = await readContract(
    client,
    getActivePiecesCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      offset: options.offset,
      limit: options.limit,
      contractAddress: options.contractAddress,
    })
  )
  return [piecesData, pieceIds, hasMore]
}

export namespace getActivePiecesCall {
  export type OptionsType = Simplify<
    getActivePieces.OptionsType & {
      chain: Chain
    }
  >

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getActivePieces'>
}

/**
 * Create a call to the getActivePieces function
 *
 * This function is used to create a call to the getActivePieces function for use with the multicall or readContract function.
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
