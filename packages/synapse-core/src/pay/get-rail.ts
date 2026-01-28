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

export namespace getRail {
  export type OptionsType = {
    /** The rail ID to query */
    railId: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<typeof paymentsAbi, 'pure' | 'view', 'getRail'>

  /**
   * The rail information from the payments contract.
   */
  export type OutputType = {
    /** The address of the ERC20 token used for payments */
    token: Address
    /** The address of the payer */
    from: Address
    /** The address of the payee */
    to: Address
    /** The address of the operator */
    operator: Address
    /** The address of the validator */
    validator: Address
    /** Payment rate per epoch (in token base units) */
    paymentRate: bigint
    /** Lockup period in epochs */
    lockupPeriod: bigint
    /** Fixed lockup amount (in token base units) */
    lockupFixed: bigint
    /** Epoch up to which the rail has been settled */
    settledUpTo: bigint
    /** End epoch (0 for active rails, > 0 for terminated rails) */
    endEpoch: bigint
    /** Commission rate in basis points (e.g., 500 = 5%) */
    commissionRateBps: bigint
    /** Address that receives service fees */
    serviceFeeRecipient: Address
  }

  export type ErrorType = getRailCall.ErrorType | ReadContractErrorType
}

/**
 * Get rail information from the Filecoin Pay contract
 *
 * Returns detailed information about a payment rail including payer, payee, payment rate,
 * lockup details, settlement status, and termination status.
 *
 * @param client - The client to use to get the rail info.
 * @param options - {@link getRail.OptionsType}
 * @returns The rail information {@link getRail.OutputType}
 * @throws Errors {@link getRail.ErrorType}
 *
 * @example
 * ```ts
 * import { getRail } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const rail = await getRail(client, {
 *   railId: 1n,
 * })
 *
 * console.log('Payer:', rail.from)
 * console.log('Payee:', rail.to)
 * console.log('Payment rate:', rail.paymentRate)
 * console.log('Is terminated:', rail.endEpoch > 0n)
 * ```
 */
export async function getRail(
  client: Client<Transport, Chain>,
  options: getRail.OptionsType
): Promise<getRail.OutputType> {
  return readContract(
    client,
    getRailCall({
      chain: client.chain,
      railId: options.railId,
      contractAddress: options.contractAddress,
    })
  )
}

export namespace getRailCall {
  export type OptionsType = {
    /** The rail ID to query */
    railId: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
    /** The chain to use to get the rail info. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'pure' | 'view', 'getRail'>
}

/**
 * Create a call to the getRail function
 *
 * This function is used to create a call to the getRail function for use with the multicall or readContract function.
 *
 * @param options - {@link getRailCall.OptionsType}
 * @returns The call to the getRail function {@link getRailCall.OutputType}
 * @throws Errors {@link getRailCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getRailCall } from '@filoz/synapse-core/pay'
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
 *     getRailCall({
 *       chain: calibration,
 *       railId: 1n,
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getRailCall(options: getRailCall.OptionsType) {
  const chain = asChain(options.chain)

  return {
    abi: chain.contracts.filecoinPay.abi,
    address: options.contractAddress ?? chain.contracts.filecoinPay.address,
    functionName: 'getRail',
    args: [options.railId],
  } satisfies getRailCall.OutputType
}
