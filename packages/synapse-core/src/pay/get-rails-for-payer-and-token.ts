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
import type { payments as paymentsAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'

export namespace getRailsForPayerAndToken {
  export type OptionsType = {
    /** The address of the payer to query */
    payer: Address
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
    'getRailsForPayerAndToken'
  >

  /**
   * Rail information for paginated results.
   */
  export type RailInfo = {
    /** The rail ID */
    railId: bigint
    /** Whether the rail is terminated */
    isTerminated: boolean
    /** End epoch (0 for active rails, > 0 for terminated rails) */
    endEpoch: bigint
  }

  /**
   * Paginated rail results for a payer and token.
   */
  export type OutputType = {
    /** Array of rail information */
    results: RailInfo[]
    /** Next offset for pagination (equals offset + results.length if more results available) */
    nextOffset: bigint
    /** Total number of rails for this payer and token */
    total: bigint
  }

  export type ErrorType = getRailsForPayerAndTokenCall.ErrorType | ReadContractErrorType
}

/**
 * Get rails for a payer and token with pagination
 *
 * Returns paginated list of rails where the specified address is the payer for the given token.
 * Use pagination (offset and limit) to handle large result sets efficiently.
 *
 * @param client - The client to use to get the rails.
 * @param options - {@link getRailsForPayerAndToken.OptionsType}
 * @returns Paginated rail results {@link getRailsForPayerAndToken.OutputType}
 * @throws Errors {@link getRailsForPayerAndToken.ErrorType}
 *
 * @example
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
 * // Get first 10 rails
 * const result = await getRailsForPayerAndToken(client, {
 *   payer: '0x1234567890123456789012345678901234567890',
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
export async function getRailsForPayerAndToken(
  client: Client<Transport, Chain>,
  options: getRailsForPayerAndToken.OptionsType
): Promise<getRailsForPayerAndToken.OutputType> {
  const chain = asChain(client.chain)
  const token = options.token ?? chain.contracts.usdfc.address

  const data = await readContract(
    client,
    getRailsForPayerAndTokenCall({
      chain: client.chain,
      payer: options.payer,
      token,
      offset: options.offset ?? 0n,
      limit: options.limit ?? 0n,
      contractAddress: options.contractAddress,
    })
  )

  return parseGetRailsForPayerAndToken(data)
}

export namespace getRailsForPayerAndTokenCall {
  export type OptionsType = {
    /** The address of the payer to query */
    payer: Address
    /** The address of the ERC20 token to filter by */
    token: Address
    /** Starting index for pagination (0-based) */
    offset: bigint
    /** Maximum number of rails to return. Use 0 to get all remaining rails. */
    limit: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
    /** The chain to use to get the rails. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'pure' | 'view', 'getRailsForPayerAndToken'>
}

/**
 * Create a call to the getRailsForPayerAndToken function
 *
 * This function is used to create a call to the getRailsForPayerAndToken function for use with the multicall or readContract function.
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

  return {
    abi: chain.contracts.payments.abi,
    address: options.contractAddress ?? chain.contracts.payments.address,
    functionName: 'getRailsForPayerAndToken',
    args: [options.payer, options.token, options.offset, options.limit],
  } satisfies getRailsForPayerAndTokenCall.OutputType
}

/**
 * Parse the contract output into the getRailsForPayerAndToken output type
 *
 * @param data - The contract output from the getRailsForPayerAndToken function
 * @returns The parsed paginated rail results {@link getRailsForPayerAndToken.OutputType}
 */
export function parseGetRailsForPayerAndToken(
  data: getRailsForPayerAndToken.ContractOutputType
): getRailsForPayerAndToken.OutputType {
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
