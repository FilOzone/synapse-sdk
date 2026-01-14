/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { Abi, AbiFunction, ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import * as Abis from '../../abis/index.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type balanceOf = ExtractAbiFunction<typeof Abis.erc20WithPermit, 'balanceOf'>
export type decimals = ExtractAbiFunction<typeof Abis.erc20WithPermit, 'decimals'>
export type allowance = ExtractAbiFunction<typeof Abis.erc20WithPermit, 'allowance'>
export type name = ExtractAbiFunction<typeof Abis.erc20WithPermit, 'name'>
export type approve = ExtractAbiFunction<typeof Abis.erc20WithPermit, 'approve'>
export type nonces = ExtractAbiFunction<typeof Abis.erc20WithPermit, 'nonces'>
export type version = ExtractAbiFunction<typeof Abis.erc20WithPermit, 'version'>

export interface ERC20Options {
  balanceOf?: (args: AbiToType<balanceOf['inputs']>) => AbiToType<balanceOf['outputs']>
  decimals?: (args: AbiToType<decimals['inputs']>) => AbiToType<decimals['outputs']>
  allowance?: (args: AbiToType<allowance['inputs']>) => AbiToType<allowance['outputs']>
  name?: (args: AbiToType<name['inputs']>) => AbiToType<name['outputs']>
  approve?: (args: AbiToType<approve['inputs']>) => AbiToType<approve['outputs']>
  version?: (args: AbiToType<version['inputs']>) => AbiToType<version['outputs']>
  nonces?: (args: AbiToType<nonces['inputs']>) => AbiToType<nonces['outputs']>
}

type AbiItem = Abi[number]
function isAbiFunction(abi: AbiItem): abi is AbiFunction {
  return abi.type === 'function'
}

/**
 * Handle ERC20 token contract calls
 */
export function erc20CallHandler(data: Hex, options: JSONRPCOptions): Hex {
  let functionName: string
  let args: readonly unknown[]

  try {
    const decoded = decodeFunctionData({
      abi: Abis.erc20WithPermit,
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

  const abi = Abis.erc20WithPermit.find((abi) => isAbiFunction(abi) && abi.name === functionName) as
    | AbiFunction
    | undefined
  if (abi === undefined) {
    throw new Error(`ERC20: unknown function: ${functionName} with args: ${args}`)
  }
  if (!abi.outputs) {
    // function type should have outputs
    throw new Error(`ERC20: malformed ABI`)
  }
  const outputAbi = abi.outputs
  if (!options.erc20) {
    throw new Error(`ERC20: missing handler`)
  }
  const outputs = options.erc20[functionName](args)
  return encodeAbiParameters(outputAbi, outputs)
}
