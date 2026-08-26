import type { Simplify } from 'type-fest'
import type { Address, Chain, Client, ReadContractErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import { asChain } from '../chains.ts'
import { type Page, type PaginationOptions, type paginate, resolvePagination } from '../pagination.ts'
import { STRING_ERRORS, stringErrorEquals } from '../utils/contract-errors.ts'
import { createPieceUrl } from '../utils/piece-url.ts'
import type { PdpDataSet, Piece } from '../warm-storage/types.ts'
import { getActivePiecesByCursorCall, parseGetActivePiecesByCursor } from './get-active-pieces-by-cursor.ts'
import { getScheduledRemovalsCall, parseScheduledRemovals } from './get-scheduled-removals.ts'

export namespace getPieces {
  export type OptionsType = Simplify<
    PaginationOptions & {
      /** The data set to get the pieces from. */
      dataSet: PdpDataSet
      /** The address of the user. */
      address: Address
      /** Optional PDPVerifier contract address override. */
      contractAddress?: Address
    }
  >

  export type OutputType = Page<Piece>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of visible pieces for a data set.
 *
 * Pieces scheduled for removal are filtered from `items`, while `nextCursor`
 * continues to describe the unfiltered source page. A page can therefore be
 * empty and still have a continuation. Treat it as opaque and use
 * {@link paginate} to traverse every page.
 *
 * @example Read the first page
 * ```ts
 * import { getPieces } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const address = '0x0000000000000000000000000000000000000000'
 * const page = await getPieces(client, { dataSet, address })
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getPieces } from '@filoz/synapse-core/pdp-verifier'
 *
 * for await (const piece of paginate(({ cursor }) =>
 *   getPieces(client, { dataSet, address, cursor })
 * )) {
 *   console.log(piece.id, piece.cid, piece.url)
 * }
 * ```
 *
 * @param client - The client to use to get the pieces.
 * @param options - {@link getPieces.OptionsType}
 * @returns The active pieces for the data set {@link getPieces.OutputType}
 * @throws Errors {@link getPieces.ErrorType}
 */
export async function getPieces(
  client: Client<Transport, Chain>,
  options: getPieces.OptionsType
): Promise<getPieces.OutputType> {
  const chain = asChain(client.chain)

  const { cursor, limit } = resolvePagination(options, 100n)

  const address = options.address
  const serviceURL = options.dataSet.provider.pdp.serviceURL
  try {
    const [activePiecesResult, removalsResult] = await multicall(client, {
      contracts: [
        getActivePiecesByCursorCall({
          chain: client.chain,
          dataSetId: options.dataSet.dataSetId,
          startPieceId: cursor,
          limit,
          contractAddress: options.contractAddress,
        }),
        getScheduledRemovalsCall({
          chain: client.chain,
          dataSetId: options.dataSet.dataSetId,
          contractAddress: options.contractAddress,
        }),
      ],
      allowFailure: false,
    })

    // deduplicate the removals
    const removals = parseScheduledRemovals(removalsResult)

    const page = parseGetActivePiecesByCursor(activePiecesResult)
    return {
      items: page.items
        .map((piece) => {
          const cid = piece.cid
          return {
            cid,
            id: piece.id,
            url: createPieceUrl({
              cid: cid.toString(),
              cdn: options.dataSet.cdn,
              address,
              chain,
              serviceURL,
            }),
          }
        })
        .filter((piece) => !removals.includes(piece.id)),
      ...(page.nextCursor == null ? {} : { nextCursor: page.nextCursor }),
    }
  } catch (error) {
    if (stringErrorEquals(error, STRING_ERRORS.PDP_VERIFIER_DATA_SET_NOT_LIVE)) {
      return {
        items: [],
      }
    }
    throw error
  }
}
