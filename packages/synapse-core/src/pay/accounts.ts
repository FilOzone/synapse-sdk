import type {
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  ReadContractErrorType,
  Transport,
} from 'viem'
import { getBlockNumber, readContract } from 'viem/actions'
import type { payments as paymentsAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'

export namespace accounts {
  export type OptionsType = {
    /** The address of the ERC20 token to query. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The address of the account to query. */
    address: Address
    /** The block number to get the account info at. */
    blockNumber?: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<typeof paymentsAbi, 'pure' | 'view', 'accounts'>

  /**
   * The account information from the payments contract.
   */
  export type OutputType = {
    /** Total funds deposited by the account */
    funds: bigint
    /** Current lockup amount (not yet settled) */
    lockupCurrent: bigint
    /** Rate at which lockup increases per epoch */
    lockupRate: bigint
    /** Epoch when lockup was last settled */
    lockupLastSettledAt: bigint
    /** Available funds for the account (funds - lockupCurrent + lockupRate * (currentEpoch - lockupLastSettledAt)) */
    availableFunds: bigint
  }

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get account information from the Filecoin Pay contract
 *
 * Returns the raw account state including deposited funds and lockup details.
 * The lockup mechanism ensures funds are available for ongoing payment rails.
 *
 * @param client - The client to use to get the account info.
 * @param options - {@link accounts.OptionsType}
 * @returns The account information {@link accounts.OutputType}
 * @throws Errors {@link accounts.ErrorType}
 *
 * @example
 * ```ts
 * import { accounts } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const accountInfo = await accounts(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log(accountInfo.funds)
 * console.log(accountInfo.lockupCurrent)
 * ```
 */
export async function accounts(
  client: Client<Transport, Chain>,
  options: accounts.OptionsType
): Promise<accounts.OutputType> {
  const currentEpoch =
    options.blockNumber ??
    (await getBlockNumber(client, {
      cacheTime: 0,
    }))
  const data = await readContract(
    client,
    accountsCall({
      chain: client.chain,
      token: options.token,
      address: options.address,
      contractAddress: options.contractAddress,
    })
  )

  return parseAccounts(data, currentEpoch)
}

export namespace accountsCall {
  export type OptionsType = {
    /** The address of the ERC20 token to query. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The address of the account to query. */
    address: Address
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
    /** The chain to use to get the account info. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'pure' | 'view', 'accounts'>
}

/**
 * Create a call to the accounts function
 *
 * This function is used to create a call to the accounts function for use with the multicall or readContract function.
 *
 * To get the same output type as the action, use {@link parseAccounts} to transform the contract output.
 *
 * @param options - {@link accountsCall.OptionsType}
 * @returns The call to the accounts function {@link accountsCall.OutputType}
 * @throws Errors {@link accountsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { accountsCall } from '@filoz/synapse-core/pay'
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
 *     accountsCall({
 *       chain: calibration,
 *       address: '0x1234567890123456789012345678901234567890',
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function accountsCall(options: accountsCall.OptionsType) {
  const chain = asChain(options.chain)
  const token = options.token ?? chain.contracts.usdfc.address

  return {
    abi: chain.contracts.payments.abi,
    address: options.contractAddress ?? chain.contracts.payments.address,
    functionName: 'accounts',
    args: [token, options.address],
  } satisfies accountsCall.OutputType
}

/**
 * Parse the contract output into the accounts output type
 *
 * @param data - The contract output from the accounts function
 * @param currentEpoch - The current epoch (block number in filecoin)
 * @returns The parsed account information {@link accounts.OutputType}
 */
export function parseAccounts(data: accounts.ContractOutputType, currentEpoch: bigint): accounts.OutputType {
  const [funds, lockupCurrent, lockupRate, lockupLastSettledAt] = data
  const epochSinceSettlement = currentEpoch - lockupLastSettledAt
  const actualLockup = lockupCurrent + epochSinceSettlement * lockupRate
  const availableFunds = funds - actualLockup
  return {
    funds: data[0],
    lockupCurrent: data[1],
    lockupRate: data[2],
    lockupLastSettledAt: data[3],
    availableFunds: availableFunds < 0n ? 0n : availableFunds,
  }
}
