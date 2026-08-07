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
import type { filecoinPay as paymentsAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'
import type { RailInfo } from './types.ts'

export namespace getRailsForPayeeAndToken {
  export type OptionsType = {
    /** The address of the payee to query */
    payee: Address
    /** The address of the ERC20 token to filter by. If not provided, the USDFC token address will be used. */
    token?: Address
    /** Starting index for pagination (0-based). Defaults to 0. */
    offset?: bigint
    /** Maximum number of rails to return. Use 0 to get all remaining rails. Defaults to 0. */
    limit?: bigint
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
  export type OutputType = {
    /** Array of rail information */
    results: RailInfo[]
    /** Next offset for pagination (equals offset + results.length if more results available) */
    nextOffset: bigint
    /** Total number of rails for this payee and token */
    total: bigint
  }

  export type ErrorType = getRailsForPayeeAndTokenCall.ErrorType | ReadContractErrorType
}

/**
 * Get rails for a payee and token with pagination
 *
 * Returns paginated list of rails where the specified address is the payee for the given token.
 * Use pagination (offset and limit) to handle large result sets efficiently.
 *
 * @param client - The client to use to get the rails.
 * @param options - {@link getRailsForPayeeAndToken.OptionsType}
 * @returns Paginated rail results {@link getRailsForPayeeAndToken.OutputType}
 * @throws Errors {@link getRailsForPayeeAndToken.ErrorType}
 *
 * @example
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
 * // Get first 10 rails
 * const result = await getRailsForPayeeAndToken(client, {
 *   payee: '0x1234567890123456789012345678901234567890',
 *   offset: 0n,
 *   limit: 10n,
 * })
 *
 * console.log(`Found ${result.total} total rails`)
 * console.log(`Returned ${result.results.length} rails`)
 * for (const rail of result.results) {
 *   console.log(`Rail ${rail.railId}: ${rail.isTerminated ? 'Terminated' : 'Active'}`)
 * }
 * ```
 */
export async function getRailsForPayeeAndToken(
  client: Client<Transport, Chain>,
  options: getRailsForPayeeAndToken.OptionsType
): Promise<getRailsForPayeeAndToken.OutputType> {
  const data = await readContract(
    client,
    getRailsForPayeeAndTokenCall({
      chain: client.chain,
      payee: options.payee,
      token: options.token,
      offset: options.offset,
      limit: options.limit,
      contractAddress: options.contractAddress,
    })
  )

  return parseGetRailsForPayeeAndToken(data)
}

export namespace getRailsForPayeeAndTokenCall {
  export type OptionsType = Simplify<getRailsForPayeeAndToken.OptionsType & ActionCallChain>

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'pure' | 'view', 'getRailsForPayeeAndToken'>
}

/**
 * Create a call to the getRailsForPayeeAndToken function
 *
 * This function is used to create a call to the getRailsForPayeeAndToken function for use with the multicall or readContract function.
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
    args: [options.payee, token, options.offset ?? 0n, options.limit ?? 0n],
  } satisfies getRailsForPayeeAndTokenCall.OutputType
}

/**
 * Parse the contract output into the getRailsForPayeeAndToken output type
 *
 * @param data - The contract output from the getRailsForPayeeAndToken function
 * @returns The parsed paginated rail results {@link getRailsForPayeeAndToken.OutputType}
 */
export function parseGetRailsForPayeeAndToken(
  data: getRailsForPayeeAndToken.ContractOutputType
): getRailsForPayeeAndToken.OutputType {
  return {
    results: data[0].map((rail) => ({
      railId: rail.railId,
      isTerminated: rail.isTerminated,
      endEpoch: rail.endEpoch,
    })),
    nextOffset: data[1],
    total: data[2],
  }
}
