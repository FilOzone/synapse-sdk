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

export namespace operatorApprovals {
  export type OptionsType = {
    /** The address of the ERC20 token to query. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The address of the account (client) to query approvals for. */
    address: Address
    /** The address of the operator to query. If not provided, the Warm Storage contract address will be used. */
    operator?: Address
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<typeof paymentsAbi, 'pure' | 'view', 'operatorApprovals'>

  /**
   * The operator approval information from the payments contract.
   */
  export type OutputType = {
    /** Whether the operator is approved to act on behalf of the client */
    isApproved: boolean
    /** Maximum rate the operator can use per epoch (in token base units) */
    rateAllowance: bigint
    /** Maximum lockup amount the operator can use (in token base units) */
    lockupAllowance: bigint
    /** Current rate being used by the operator (in token base units) */
    rateUsage: bigint
    /** Current lockup being used by the operator (in token base units) */
    lockupUsage: bigint
    /** Maximum lockup period in epochs the operator can set for payment rails */
    maxLockupPeriod: bigint
  }

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get operator approval information from the Filecoin Pay contract
 *
 * Returns the approval status and allowances for an operator acting on behalf of a client.
 * Operators can create and manage payment rails within their approved allowances.
 *
 * @param client - The viem client to use for the contract call.
 * @param options - {@link operatorApprovals.OptionsType}
 * @returns The operator approval information {@link operatorApprovals.OutputType}
 * @throws Errors {@link operatorApprovals.ErrorType}
 *
 * @example
 * ```ts
 * import { operatorApprovals } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const approval = await operatorApprovals(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log(approval.isApproved)
 * console.log(approval.rateAllowance)
 * console.log(approval.lockupAllowance)
 * ```
 */
export async function operatorApprovals(
  client: Client<Transport, Chain>,
  options: operatorApprovals.OptionsType
): Promise<operatorApprovals.OutputType> {
  const data = await readContract(
    client,
    operatorApprovalsCall({
      chain: client.chain,
      token: options.token,
      address: options.address,
      operator: options.operator,
      contractAddress: options.contractAddress,
    })
  )

  return parseOperatorApprovals(data)
}

export namespace operatorApprovalsCall {
  export type OptionsType = {
    /** The address of the ERC20 token to query. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The address of the account to query approvals for. */
    address: Address
    /** The address of the operator to query. If not provided, the Warm Storage contract address will be used. */
    operator?: Address
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
    /** The chain to use for the contract call. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'pure' | 'view', 'operatorApprovals'>
}

/**
 * Create a call to the operatorApprovals function
 *
 * This function is used to create a call to the operatorApprovals function for use with the multicall or readContract function.
 * Use {@link parseOperatorApprovals} to transform the contract output into the action output type.
 *
 * @param options - {@link operatorApprovalsCall.OptionsType}
 * @returns The call to the operatorApprovals function {@link operatorApprovalsCall.OutputType}
 * @throws Errors {@link operatorApprovalsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { operatorApprovalsCall, parseOperatorApprovals } from '@filoz/synapse-core/pay'
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
 *     operatorApprovalsCall({
 *       chain: calibration,
 *       address: '0x1234567890123456789012345678901234567890',
 *     }),
 *   ],
 * })
 *
 * if (results[0].status === 'success') {
 *   const approval = parseOperatorApprovals(results[0].result)
 *   console.log(approval.isApproved)
 * }
 * ```
 */
export function operatorApprovalsCall(options: operatorApprovalsCall.OptionsType) {
  const chain = asChain(options.chain)
  const token = options.token ?? chain.contracts.usdfc.address
  const operator = options.operator ?? chain.contracts.storage.address

  return {
    abi: chain.contracts.payments.abi,
    address: options.contractAddress ?? chain.contracts.payments.address,
    functionName: 'operatorApprovals',
    args: [token, options.address, operator],
  } satisfies operatorApprovalsCall.OutputType
}

/**
 * Parse the contract output into the operatorApprovals output type
 *
 * @param data - The contract output from the operatorApprovals function
 * @returns The parsed operator approval information {@link operatorApprovals.OutputType}
 */
export function parseOperatorApprovals(data: operatorApprovals.ContractOutputType): operatorApprovals.OutputType {
  return {
    isApproved: data[0],
    rateAllowance: data[1],
    lockupAllowance: data[2],
    rateUsage: data[3],
    lockupUsage: data[4],
    maxLockupPeriod: data[5],
  }
}
