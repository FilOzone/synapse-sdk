import type { Simplify } from 'type-fest'
import {
  type Address,
  type Chain,
  type Client,
  type ContractFunctionParameters,
  type ContractFunctionReturnType,
  type ReadContractErrorType,
  type Transport,
  toHex,
} from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { PieceCID } from '../piece/piece.ts'
import type { ActionCallChain } from '../types.ts'

export namespace findPieceIdsByCid {
  export type OptionsType = {
    /** The ID of the data set to search in. */
    dataSetId: bigint
    /** The PieceCID to search for. */
    pieceCid: PieceCID
    /** The starting piece ID for the search. @default 0n */
    startPieceId?: bigint
    /** The maximum number of results to return. @default 1n */
    limit?: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = readonly bigint[]

  /**
   * `uint256[]` - Array of piece IDs matching the given CID
   */
  export type ContractOutputType = ContractFunctionReturnType<
    typeof pdpVerifierAbi,
    'pure' | 'view',
    'findPieceIdsByCid'
  >

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Find piece IDs for a given PieceCID in a data set.
 *
 * Uses the on-chain `findPieceIdsByCid` function for efficient CID→ID lookup.
 *
 * @example
 * ```ts
 * import { findPieceIdsByCid } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 * import * as Piece from '@filoz/synapse-core/piece'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const pieceCid = Piece.parse('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
 * const pieceIds = await findPieceIdsByCid(client, {
 *   dataSetId: 1n,
 *   pieceCid,
 * })
 * // pieceIds is an array of bigint IDs matching the CID
 * ```
 *
 * @param client - The client to use to find piece IDs.
 * @param options - {@link findPieceIdsByCid.OptionsType}
 * @returns Array of piece IDs matching the CID {@link findPieceIdsByCid.OutputType}
 * @throws Errors {@link findPieceIdsByCid.ErrorType}
 */
export async function findPieceIdsByCid(
  client: Client<Transport, Chain>,
  options: findPieceIdsByCid.OptionsType
): Promise<findPieceIdsByCid.OutputType> {
  return await readContract(
    client,
    findPieceIdsByCidCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      pieceCid: options.pieceCid,
      startPieceId: options.startPieceId,
      limit: options.limit,
      contractAddress: options.contractAddress,
    })
  )
}

export namespace findPieceIdsByCidCall {
  export type OptionsType = Simplify<findPieceIdsByCid.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'findPieceIdsByCid'>
}

/**
 * Create a call to the {@link findPieceIdsByCid} function for use with the multicall or readContract function.
 *
 * @example
 * ```ts
 * import { findPieceIdsByCidCall } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 * import { readContract } from 'viem/actions'
 * import * as Piece from '@filoz/synapse-core/piece'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const pieceCid = Piece.parse('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
 * const result = await readContract(client, findPieceIdsByCidCall({
 *   chain: calibration,
 *   dataSetId: 1n,
 *   pieceCid,
 * }))
 * ```
 *
 * @param options - {@link findPieceIdsByCidCall.OptionsType}
 * @returns The call to the findPieceIdsByCid function {@link findPieceIdsByCidCall.OutputType}
 * @throws Errors {@link findPieceIdsByCidCall.ErrorType}
 */
export function findPieceIdsByCidCall(options: findPieceIdsByCidCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'findPieceIdsByCid',
    args: [options.dataSetId, { data: toHex(options.pieceCid.bytes) }, options.startPieceId ?? 0n, options.limit ?? 1n],
  } satisfies findPieceIdsByCidCall.OutputType
}
