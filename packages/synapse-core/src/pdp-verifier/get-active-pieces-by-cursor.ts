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
import { type Page, type PaginationOptions, type paginate, resolvePagination } from '../pagination.ts'
import { from as pieceFrom } from '../piece/parse.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import type { PaginatedActionCallOptions } from '../types.ts'
import { STRING_ERRORS, stringErrorEquals } from '../utils/contract-errors.ts'
import { toReadClient } from '../utils/read-client.ts'

export namespace getActivePiecesByCursor {
  export type OptionsType = PaginationOptions & {
    /** The ID of the data set to get active pieces for. */
    dataSetId: bigint
    /** PDP Verifier contract address override. */
    contractAddress?: Address
  }

  export type Item = { cid: PieceCID; id: bigint }
  export type OutputType = Page<Item>
  export type ContractOutputType = ContractFunctionReturnType<
    typeof pdpVerifierAbi,
    'pure' | 'view',
    'getActivePiecesByCursor'
  >
  export type ErrorType = getActivePiecesByCursorCall.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of active pieces using efficient piece-ID cursors.
 *
 * The cursor is a piece ID, but callers should still treat `nextCursor` as
 * opaque and pass it back unchanged. Use {@link paginate} to traverse every
 * page, including sparse piece-ID ranges.
 *
 * @param client - Client used to read the PDP Verifier.
 * @param options - {@link getActivePiecesByCursor.OptionsType}
 * @returns A page of active pieces {@link getActivePiecesByCursor.OutputType}
 * @throws Errors {@link getActivePiecesByCursor.ErrorType}
 *
 * @example Read the first page
 * ```ts
 * import { getActivePiecesByCursor } from '@filoz/synapse-core/pdp-verifier'
 *
 * const page = await getActivePiecesByCursor(client, { dataSetId: 1n })
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getActivePiecesByCursor } from '@filoz/synapse-core/pdp-verifier'
 *
 * for await (const piece of paginate(({ cursor }) =>
 *   getActivePiecesByCursor(client, { dataSetId: 1n, cursor })
 * )) {
 *   console.log(piece.id, piece.cid)
 * }
 * ```
 */
export async function getActivePiecesByCursor(
  client: Client<Transport, Chain>,
  options: getActivePiecesByCursor.OptionsType
): Promise<getActivePiecesByCursor.OutputType> {
  const { cursor, limit } = resolvePagination(options, 100n)
  try {
    const data = await readContract(
      toReadClient(client),
      getActivePiecesByCursorCall({
        chain: client.chain,
        dataSetId: options.dataSetId,
        startPieceId: cursor,
        limit,
        contractAddress: options.contractAddress,
      })
    )
    return parseGetActivePiecesByCursor(data)
  } catch (error) {
    if (stringErrorEquals(error, STRING_ERRORS.PDP_VERIFIER_DATA_SET_NOT_LIVE)) {
      return { items: [] }
    }
    throw error
  }
}

export namespace getActivePiecesByCursorCall {
  export type OptionsType = PaginatedActionCallOptions<getActivePiecesByCursor.OptionsType, 'startPieceId'>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getActivePiecesByCursor'>
}

/**
 * Create a call to the {@link getActivePiecesByCursor} contract function for
 * use with Viem's `multicall` or `readContract` functions.
 *
 * This is a literal contract adapter: `startPieceId` and `limit` are required,
 * use their contract-facing names, and are passed through unchanged. Use
 * {@link parseGetActivePiecesByCursor} to convert the raw contract output into
 * a normalized {@link getActivePiecesByCursor.OutputType} page.
 *
 * @example
 * ```ts
 * import {
 *   getActivePiecesByCursorCall,
 *   parseGetActivePiecesByCursor,
 * } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 * import { readContract } from 'viem/actions'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const result = await readContract(client, getActivePiecesByCursorCall({
 *   chain: calibration,
 *   dataSetId: 1n,
 *   startPieceId: 0n,
 *   limit: 100n,
 * }))
 * const page = parseGetActivePiecesByCursor(result)
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @param options - {@link getActivePiecesByCursorCall.OptionsType}
 * @returns The contract call parameters {@link getActivePiecesByCursorCall.OutputType}
 * @throws Errors {@link getActivePiecesByCursorCall.ErrorType}
 */
export function getActivePiecesByCursorCall(options: getActivePiecesByCursorCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getActivePiecesByCursor',
    args: [options.dataSetId, options.startPieceId, options.limit],
  } satisfies getActivePiecesByCursorCall.OutputType
}

/**
 * Parse raw `getActivePiecesByCursor` contract output into a normalized page.
 *
 * Piece data is converted to {@link PieceCID}, piece IDs are paired by their
 * matching array index, and the contract's `hasMore` flag is translated into
 * an opaque `nextCursor`. The cursor is omitted when the contract reports that
 * no more active pieces remain.
 *
 * @param data - Raw contract output {@link getActivePiecesByCursor.ContractOutputType}
 * @returns A normalized page of active pieces {@link getActivePiecesByCursor.OutputType}
 */
export function parseGetActivePiecesByCursor(
  data: getActivePiecesByCursor.ContractOutputType
): getActivePiecesByCursor.OutputType {
  const items = data[0].map((piece, index) => ({
    cid: pieceFrom(piece.data),
    id: data[1][index],
  }))
  const last = items.at(-1)
  return {
    items,
    ...(data[2] && last != null ? { nextCursor: last.id + 1n } : {}),
  }
}
