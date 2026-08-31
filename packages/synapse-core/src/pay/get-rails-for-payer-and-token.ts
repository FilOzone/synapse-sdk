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
import type { filecoinPay as paymentsAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import { type PageWithTotal, type PaginationOptions, type paginate, resolvePagination } from '../pagination.ts'
import type { PaginatedActionCallOptions } from '../types.ts'
import type { RailInfo } from './types.ts'

export namespace getRailsForPayerAndToken {
  export type OptionsType = PaginationOptions & {
    /** The address of the payer to query */
    payer: Address
    /** The address of the ERC20 token to filter by. If not provided, the USDFC token address will be used. */
    token?: Address
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof paymentsAbi,
    'pure' | 'view',
    'getRailsForPayerAndToken'
  >

  /**
   * Paginated rail results for a payer and token.
   */
  /** A rail page. `total` is the contract's underlying rail-slot count, including skipped or finalized slots. */
  export type OutputType = PageWithTotal<RailInfo>

  export type ErrorType = getRailsForPayerAndTokenCall.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of rails for a payer and token.
 *
 * Pass the returned `nextCursor` back as `cursor`; treat it as opaque. Use
 * {@link paginate} to traverse every page. `total` is the contract's underlying
 * rail-slot count, including slots skipped because their rails were finalized.
 *
 * @param client - The client to use to get the rails.
 * @param options - {@link getRailsForPayerAndToken.OptionsType}
 * @returns Paginated rail results {@link getRailsForPayerAndToken.OutputType}
 * @throws Errors {@link getRailsForPayerAndToken.ErrorType}
 *
 * @example Read the first page
 * ```ts
 * import { getRailsForPayerAndToken } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const payer = '0x1234567890123456789012345678901234567890'
 * const page = await getRailsForPayerAndToken(client, { payer })
 * console.log(page.items, page.nextCursor, page.total)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getRailsForPayerAndToken } from '@filoz/synapse-core/pay'
 *
 * for await (const rail of paginate(({ cursor }) =>
 *   getRailsForPayerAndToken(client, { payer, cursor })
 * )) {
 *   console.log(`Rail ${rail.railId}: ${rail.isTerminated ? 'Terminated' : 'Active'}`)
 * }
 * ```
 */
export async function getRailsForPayerAndToken(
  client: Client<Transport, Chain>,
  options: getRailsForPayerAndToken.OptionsType
): Promise<getRailsForPayerAndToken.OutputType> {
  const { cursor, limit } = resolvePagination(options, 100n)
  const data = await readContract(
    client,
    getRailsForPayerAndTokenCall({
      chain: client.chain,
      payer: options.payer,
      token: options.token,
      offset: cursor,
      limit,
      contractAddress: options.contractAddress,
    })
  )

  return parseGetRailsForPayerAndToken(data)
}

export namespace getRailsForPayerAndTokenCall {
  export type OptionsType = PaginatedActionCallOptions<getRailsForPayerAndToken.OptionsType, 'offset'>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'pure' | 'view', 'getRailsForPayerAndToken'>
}

/**
 * Create a call to the getRailsForPayerAndToken function
 *
 * This function is used to create a call to the getRailsForPayerAndToken function for use with the multicall or readContract function.
 *
 * To get the same output type as the action, use {@link parseGetRailsForPayerAndToken} to transform the contract output.
 *
 * @param options - {@link getRailsForPayerAndTokenCall.OptionsType}
 * @returns The call to the getRailsForPayerAndToken function {@link getRailsForPayerAndTokenCall.OutputType}
 * @throws Errors {@link getRailsForPayerAndTokenCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getRailsForPayerAndTokenCall } from '@filoz/synapse-core/pay'
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
 *     getRailsForPayerAndTokenCall({
 *       chain: calibration,
 *       payer: '0x1234567890123456789012345678901234567890',
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
export function getRailsForPayerAndTokenCall(options: getRailsForPayerAndTokenCall.OptionsType) {
  const chain = asChain(options.chain)
  const token = options.token ?? chain.contracts.usdfc.address

  return {
    abi: chain.contracts.filecoinPay.abi,
    address: options.contractAddress ?? chain.contracts.filecoinPay.address,
    functionName: 'getRailsForPayerAndToken',
    args: [options.payer, token, options.offset, options.limit],
  } satisfies getRailsForPayerAndTokenCall.OutputType
}

/**
 * Parse raw payer-rail contract output into a normalized page with a total.
 *
 * The contract's `results` tuple is mapped to `items`, including finalized and
 * skipped rail slots. `nextOffset` becomes `nextCursor` only when it is less
 * than `total`; `total` is the underlying rail-slot count.
 *
 * @param data - Raw contract output {@link getRailsForPayerAndToken.ContractOutputType}
 * @returns A normalized rail page {@link getRailsForPayerAndToken.OutputType}
 */
export function parseGetRailsForPayerAndToken(
  data: getRailsForPayerAndToken.ContractOutputType
): getRailsForPayerAndToken.OutputType {
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
