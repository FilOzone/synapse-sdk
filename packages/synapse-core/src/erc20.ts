/**
 * ERC20 Contract Operations
 *
 * @example
 * ```ts
 * import * as ERC20 from '@filoz/synapse-core/erc20'
 * ```
 *
 * @module erc20
 */

import {
  type Account,
  type Address,
  type Chain,
  type Client,
  erc20Abi,
  type MulticallErrorType,
  type SimulateContractErrorType,
  type Transport,
  type WriteContractErrorType,
} from 'viem'
import { multicall, simulateContract, writeContract } from 'viem/actions'
import * as Abis from './abis/index.ts'
import { getChain } from './chains.ts'
import { AllowanceAmountError } from './errors/erc20.ts'

export type ERC20BalanceOptions = {
  /**
   * The address of the ERC20 token to query.
   * If not provided, the USDFC token address will be used.
   */
  token?: Address
  /**
   * The address of the account to query.
   */
  address: Address
}

export type ERC20BalanceResult = {
  value: bigint
  decimals: number
  symbol: string
  allowance: bigint
}

/**
 * Get the balance, decimals, symbol, and allowance of an ERC20 token.
 *
 * @param client - The client to use.
 * @param options - The props to use. {@link ERC20BalanceOptions}
 * @returns The balance, decimals, symbol, and allowance. {@link ERC20BalanceResult}
 * @throws - {@link MulticallErrorType} if the multicall fails.
 */
export async function balance(
  client: Client<Transport, Chain>,
  options: ERC20BalanceOptions
): Promise<ERC20BalanceResult> {
  const chain = getChain(client.chain.id)
  const token = options.token ?? chain.contracts.usdfc.address

  const result = await multicall(client, {
    allowFailure: false,
    contracts: [
      {
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [options.address],
      },
      {
        address: token,
        abi: erc20Abi,
        functionName: 'decimals',
      },
      {
        address: token,
        abi: erc20Abi,
        functionName: 'symbol',
      },
      {
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [options.address, chain.contracts.payments.address],
      },
    ],
  })

  return {
    value: result[0],
    decimals: result[1],
    symbol: result[2],
    allowance: result[3],
  }
}

export type ERC20BalanceForPermitOptions = {
  /**
   * The address of the ERC20 token to query.
   * If not provided, the USDFC token address will be used.
   */
  token?: Address
  /**
   * The address of the account to query.
   */
  address: Address
}

export type ERC20BalanceForPermitResult = {
  value: bigint
  name: string
  nonce: bigint
  version: string
}

/**
 * Get the balance, name, nonce, and version of an ERC20 token.
 *
 * @param client - The client to use.
 * @param options - The props to use. {@link ERC20BalanceOptions}
 * @returns The balance, name, nonce, and version. {@link ERC20BalanceResult}
 * @throws - {@link MulticallErrorType} if the multicall fails.
 */
export async function balanceForPermit(
  client: Client<Transport, Chain>,
  options: ERC20BalanceForPermitOptions
): Promise<ERC20BalanceForPermitResult> {
  const chain = getChain(client.chain.id)
  const token = options.token ?? chain.contracts.usdfc.address

  const result = await multicall(client, {
    allowFailure: false,
    contracts: [
      {
        address: token,
        abi: Abis.erc20WithPermit,
        functionName: 'balanceOf',
        args: [options.address],
      },
      {
        address: token,
        abi: Abis.erc20WithPermit,
        functionName: 'name',
      },
      {
        address: token,
        abi: Abis.erc20WithPermit,
        functionName: 'nonces',
        args: [options.address],
      },
      {
        address: token,
        abi: Abis.erc20WithPermit,
        functionName: 'version',
      },
    ],
  })

  return {
    value: result[0],
    name: result[1],
    nonce: result[2],
    version: result[3],
  }
}

export type ERC20ApproveAllowanceOptions = {
  /**
   * The address of the ERC20 token to query.
   * If not provided, the USDFC token address will be used.
   */
  token?: Address

  /**
   * The amount to approve.
   */
  amount: bigint

  /**
   * The address of the spender to approve.
   */
  spender?: Address
}

/**
 * Approve the allowance of the ERC20 token to the payments contract.
 *
 * @param client - The client to use.
 * @param options - The props to use.
 * @returns The hash of the approve transaction.
 * @throws - {@link SimulateContractErrorType} if the simulate contract fails.
 * @throws - {@link WriteContractErrorType} if the write contract fails.
 */
export async function approveAllowance(
  client: Client<Transport, Chain, Account>,
  options: ERC20ApproveAllowanceOptions
) {
  const chain = getChain(client.chain.id)
  const token = options.token ?? chain.contracts.usdfc.address
  const spender = options.spender ?? chain.contracts.payments.address
  if (options.amount < 0n) {
    throw new AllowanceAmountError(options.amount)
  }

  const { request } = await simulateContract(client, {
    account: client.account,
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, options.amount],
  })
  const approve = await writeContract(client, request)
  return approve
}
