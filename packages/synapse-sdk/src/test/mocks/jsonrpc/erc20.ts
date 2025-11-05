/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type balanceOf = ExtractAbiFunction<typeof CONTRACT_ABIS.ERC20_PERMIT, 'balanceOf'>
export type decimals = ExtractAbiFunction<typeof CONTRACT_ABIS.ERC20_PERMIT, 'decimals'>
export type allowance = ExtractAbiFunction<typeof CONTRACT_ABIS.ERC20_PERMIT, 'allowance'>
export type name = ExtractAbiFunction<typeof CONTRACT_ABIS.ERC20_PERMIT, 'name'>
export type approve = ExtractAbiFunction<typeof CONTRACT_ABIS.ERC20_PERMIT, 'approve'>
export type nonces = ExtractAbiFunction<typeof CONTRACT_ABIS.ERC20_PERMIT, 'nonces'>
export type version = ExtractAbiFunction<typeof CONTRACT_ABIS.ERC20_PERMIT, 'version'>

export interface ERC20Options {
  balanceOf?: (args: AbiToType<balanceOf['inputs']>) => AbiToType<balanceOf['outputs']>
  decimals?: (args: AbiToType<decimals['inputs']>) => AbiToType<decimals['outputs']>
  allowance?: (args: AbiToType<allowance['inputs']>) => AbiToType<allowance['outputs']>
  name?: (args: AbiToType<name['inputs']>) => AbiToType<name['outputs']>
  approve?: (args: AbiToType<approve['inputs']>) => AbiToType<approve['outputs']>
  version?: (args: AbiToType<version['inputs']>) => AbiToType<version['outputs']>
  nonces?: (args: AbiToType<nonces['inputs']>) => AbiToType<nonces['outputs']>
}

/**
 * Handle ERC20 token contract calls
 */
export function erc20CallHandler(data: Hex, options: JSONRPCOptions): Hex {
  let functionName: string
  let args: readonly unknown[]

  try {
    const decoded = decodeFunctionData({
      abi: CONTRACT_ABIS.ERC20_PERMIT,
      data: data as Hex,
    })
    functionName = decoded.functionName
    args = decoded.args
  } catch {
    throw new Error(`ERC20: failed to decode function data: ${data}`)
  }

  if (options.debug) {
    console.debug('ERC20: calling function', functionName, 'with args', args)
  }

  switch (functionName) {
    case 'balanceOf': {
      if (!options.erc20?.balanceOf) {
        throw new Error('ERC20: balanceOf is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.ERC20_PERMIT.find((abi) => abi.type === 'function' && abi.name === 'balanceOf')!.outputs,
        options.erc20.balanceOf(args as AbiToType<balanceOf['inputs']>)
      )
    }

    case 'decimals': {
      if (!options.erc20?.decimals) {
        throw new Error('ERC20: decimals is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.ERC20_PERMIT.find((abi) => abi.type === 'function' && abi.name === 'decimals')!.outputs,
        options.erc20.decimals(args as AbiToType<decimals['inputs']>)
      )
    }

    case 'allowance': {
      if (!options.erc20?.allowance) {
        throw new Error('ERC20: allowance is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.ERC20_PERMIT.find((abi) => abi.type === 'function' && abi.name === 'allowance')!.outputs,
        options.erc20.allowance(args as AbiToType<allowance['inputs']>)
      )
    }

    case 'name': {
      if (!options.erc20?.name) {
        throw new Error('ERC20: name is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.ERC20_PERMIT.find((abi) => abi.type === 'function' && abi.name === 'name')!.outputs,
        options.erc20.name(args as AbiToType<name['inputs']>)
      )
    }

    case 'approve': {
      if (!options.erc20?.approve) {
        throw new Error('ERC20: approve is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.ERC20_PERMIT.find((abi) => abi.type === 'function' && abi.name === 'approve')!.outputs,
        options.erc20.approve(args as AbiToType<approve['inputs']>)
      )
    }

    case 'version': {
      if (!options.erc20?.version) {
        throw new Error('ERC20: version is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.ERC20_PERMIT.find((abi) => abi.type === 'function' && abi.name === 'version')!.outputs,
        options.erc20.version(args as AbiToType<version['inputs']>)
      )
    }

    case 'nonces': {
      if (!options.erc20?.nonces) {
        throw new Error('ERC20: nonces is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.ERC20_PERMIT.find((abi) => abi.type === 'function' && abi.name === 'nonces')!.outputs,
        options.erc20.nonces(args as AbiToType<nonces['inputs']>)
      )
    }

    default: {
      throw new Error(`ERC20: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
