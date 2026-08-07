import type {
  Address,
  Chain,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  ReadContractErrorType,
} from 'viem'
import { readContract } from 'viem/actions'
import type { filecoinPay as paymentsAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import { type PageWithTotal, type PaginationOptions, type paginate, resolvePagination } from '../pagination.ts'
import type { PaginatedActionCallOptions, ReadClient } from '../types.ts'
import type { RailInfo } from './types.ts'

export namespace getRailsForPayeeAndToken {
  export type OptionsType = PaginationOptions & {
    /** The address of the payee to query */
    payee: Address
    /** The address of the ERC20 token to filter by. If not provided, the USDFC token address will be used. */
    token?: Address
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof paymentsAbi,
    'pure' | 'view',
    'getRailsForPayeeAndToken'
  >

  /**
   * Paginated rail results for a payee and token.
   */
  /** A rail page. `total` is the contract's underlying rail-slot count, including skipped or finalized slots. */
  export type OutputType = PageWithTotal<RailInfo>

  export type ErrorType = getRailsForPayeeAndTokenCall.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of rails for a payee and token.
 *
 * Pass the returned `nextCursor` back as `cursor`; treat it as opaque. Use
 * {@link paginate} to traverse every page. `total` is the contract's underlying
 * rail-slot count, including slots skipped because their rails were finalized.
 *
 * @param client - The read-only client to use to get the rails.
 * @param options - {@link getRailsForPayeeAndToken.OptionsType}
 * @returns Paginated rail results {@link getRailsForPayeeAndToken.OutputType}
 * @throws Errors {@link getRailsForPayeeAndToken.ErrorType}
 *
 * @example Read the first page
 * ```ts
 * import { getRailsForPayeeAndToken } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const payee = '0x1234567890123456789012345678901234567890'
 * const page = await getRailsForPayeeAndToken(client, { payee })
 * console.log(page.items, page.nextCursor, page.total)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getRailsForPayeeAndToken } from '@filoz/synapse-core/pay'
 *
 * for await (const rail of paginate(({ cursor }) =>
 *   getRailsForPayeeAndToken(client, { payee, cursor })
 * )) {
 *   console.log(rail.railId)
 * }
 * ```
 */
export async function getRailsForPayeeAndToken<chain extends Chain>(
  client: ReadClient<chain>,
  options: getRailsForPayeeAndToken.OptionsType
): Promise<getRailsForPayeeAndToken.OutputType> {
  const { cursor, limit } = resolvePagination(options, 100n)
  const data = await readContract(
    client,
    getRailsForPayeeAndTokenCall({
      chain: client.chain,
      payee: options.payee,
      token: options.token,
      offset: cursor,
      limit,
      contractAddress: options.contractAddress,
    })
  )

  return parseGetRailsForPayeeAndToken(data)
}

export namespace getRailsForPayeeAndTokenCall {
  export type OptionsType = PaginatedActionCallOptions<getRailsForPayeeAndToken.OptionsType, 'offset'>

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'pure' | 'view', 'getRailsForPayeeAndToken'>
}

/**
 * Create a call to the getRailsForPayeeAndToken function
 *
 * This function is used to create a call to the getRailsForPayeeAndToken function for use with the multicall or readContract function.
 *
 * To get the same output type as the action, use {@link parseGetRailsForPayeeAndToken} to transform the contract output.
 *
 * @param options - {@link getRailsForPayeeAndTokenCall.OptionsType}
 * @returns The call to the getRailsForPayeeAndToken function {@link getRailsForPayeeAndTokenCall.OutputType}
 * @throws Errors {@link getRailsForPayeeAndTokenCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getRailsForPayeeAndTokenCall } from '@filoz/synapse-core/pay'
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
 *     getRailsForPayeeAndTokenCall({
 *       chain: calibration,
 *       payee: '0x1234567890123456789012345678901234567890',
 *       token: calibration.contracts.usdfc.address,
 *       offset: 0n,
 *       limit: 10n,
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getRailsForPayeeAndTokenCall(options: getRailsForPayeeAndTokenCall.OptionsType) {
  const chain = asChain(options.chain)
  const token = options.token ?? chain.contracts.usdfc.address
  return {
    abi: chain.contracts.filecoinPay.abi,
    address: options.contractAddress ?? chain.contracts.filecoinPay.address,
    functionName: 'getRailsForPayeeAndToken',
    args: [options.payee, token, options.offset, options.limit],
  } satisfies getRailsForPayeeAndTokenCall.OutputType
}

/**
 * Parse raw payee-rail contract output into a normalized page with a total.
 *
 * The contract's `results` tuple is mapped to `items`, including finalized and
 * skipped rail slots. `nextOffset` becomes `nextCursor` only when it is less
 * than `total`; `total` is the underlying rail-slot count.
 *
 * @param data - Raw contract output {@link getRailsForPayeeAndToken.ContractOutputType}
 * @returns A normalized rail page {@link getRailsForPayeeAndToken.OutputType}
 */
export function parseGetRailsForPayeeAndToken(
  data: getRailsForPayeeAndToken.ContractOutputType
): getRailsForPayeeAndToken.OutputType {
  return {
    items: data[0].map((rail) => ({
      railId: rail.railId,
      isTerminated: rail.isTerminated,
      endEpoch: rail.endEpoch,
    })),
    ...(data[1] < data[2] ? { nextCursor: data[1] } : {}),
    total: data[2],
  }
}
