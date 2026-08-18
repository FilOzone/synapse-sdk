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
import {
  type Page,
  type PaginationOptions,
  pageFromLookahead,
  type paginate,
  resolvePagination,
} from '../pagination.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import type { PaginatedActionCallOptions } from '../types.ts'
import { toReadClient } from '../utils/read-client.ts'

export namespace findPieceIdsByCid {
  export type OptionsType = PaginationOptions & {
    /** The ID of the data set to search in. */
    dataSetId: bigint
    /** The PieceCID to search for. */
    pieceCid: PieceCID
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Page<bigint>

  /**
   * `uint256[]` - Array of piece IDs matching the given CID
   */
  export type ContractOutputType = ContractFunctionReturnType<
    typeof pdpVerifierAbi,
    'pure' | 'view',
    'findPieceIdsByCid'
  >

  export type ErrorType = asChain.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Find one bounded page of piece IDs matching a PieceCID in a data set.
 *
 * Uses the on-chain `findPieceIdsByCid` function for efficient CID-to-ID
 * lookup. Pass `nextCursor` back unchanged; use {@link paginate} to collect
 * every match. The default page size is one match.
 *
 * @example Read the first page
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
 * const pieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
 * const page = await findPieceIdsByCid(client, { dataSetId: 1n, pieceCid })
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { findPieceIdsByCid } from '@filoz/synapse-core/pdp-verifier'
 *
 * for await (const pieceId of paginate(({ cursor }) =>
 *   findPieceIdsByCid(client, { dataSetId: 1n, pieceCid, cursor })
 * )) {
 *   console.log(pieceId)
 * }
 * ```
 *
 * @param client - The client to use to find piece IDs.
 * @param options - {@link findPieceIdsByCid.OptionsType}
 * @returns A page of piece IDs matching the CID {@link findPieceIdsByCid.OutputType}
 * @throws Errors {@link findPieceIdsByCid.ErrorType}
 */
export async function findPieceIdsByCid(
  client: Client<Transport, Chain>,
  options: findPieceIdsByCid.OptionsType
): Promise<findPieceIdsByCid.OutputType> {
  const { cursor, limit } = resolvePagination(options, 1n)
  const data = await readContract(
    toReadClient(client),
    findPieceIdsByCidCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      pieceCid: options.pieceCid,
      startPieceId: cursor,
      limit: limit + 1n,
      contractAddress: options.contractAddress,
    })
  )
  return pageFromLookahead(data, limit, (last) => last + 1n)
}

export namespace findPieceIdsByCidCall {
  export type OptionsType = PaginatedActionCallOptions<findPieceIdsByCid.OptionsType, 'startPieceId'>
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
 * const pieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
 * const result = await readContract(client, findPieceIdsByCidCall({
 *   chain: calibration,
 *   dataSetId: 1n,
 *   pieceCid,
 *   startPieceId: 0n,
 *   limit: 1n,
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
    args: [options.dataSetId, { data: toHex(options.pieceCid.bytes) }, options.startPieceId, options.limit],
  } satisfies findPieceIdsByCidCall.OutputType
}
