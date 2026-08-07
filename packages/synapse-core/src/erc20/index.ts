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

import { type Address, type Chain, erc20Abi, type MulticallErrorType } from 'viem'
import { multicall } from 'viem/actions'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ReadClient } from '../types.ts'

export namespace balance {
  export type OptionsType = {
    /**
     * The address of the ERC20 token to query.
     * If not provided, the USDFC token address will be used.
     */
    token?: Address
    /**
     * The address of the account to query.
     */
    address: Address
    /**
     * The address of the spender to query.
     * If not provided, the Filcoin Pay contract address will be used.
     */
    spender?: Address
  }

  export type OutputType = {
    value: bigint
    decimals: number
    symbol: string
    allowance: bigint
  }

  export type ErrorType = MulticallErrorType | asChain.ErrorType
}

/**
 * Get the balance, decimals, symbol, and allowance of an ERC20 token.
 *
 * @param client - The read-only client to use to get the ERC20 balance.
 * @param options - {@link balance.OptionsType}
 * @returns The balance, decimals, symbol, and allowance. {@link balance.OutputType}
 * @throws Errors {@link balance.ErrorType}
 */
export async function balance<chain extends Chain>(
  client: ReadClient<chain>,
  options: balance.OptionsType
): Promise<balance.OutputType> {
  const chain = asChain(client.chain)
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
        args: [options.address, options.spender ?? chain.contracts.filecoinPay.address],
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

export namespace balanceForPermit {
  export type OptionsType = {
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

  export type OutputType = {
    value: bigint
    name: string
    nonce: bigint
    version: string
  }

  export type ErrorType = MulticallErrorType | asChain.ErrorType
}

/**
 * Get the balance, name, nonce, and version of an ERC20 token.
 *
 * @param client - The read-only client to use to get the ERC20 balance for permit.
 * @param options - {@link balanceForPermit.OptionsType}
 * @returns The balance, name, nonce, and version. {@link balanceForPermit.OutputType}
 * @throws Errors {@link balanceForPermit.ErrorType}
 */
export async function balanceForPermit<chain extends Chain>(
  client: ReadClient<chain>,
  options: balanceForPermit.OptionsType
): Promise<balanceForPermit.OutputType> {
  const chain = asChain(client.chain)
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

export * from './approve.ts'
