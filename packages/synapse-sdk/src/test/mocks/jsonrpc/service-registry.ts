/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type getProviderByAddress = ExtractAbiFunction<
  typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY,
  'getProviderByAddress'
>

export type getProvider = ExtractAbiFunction<typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY, 'getProvider'>

export type getProviderIdByAddress = ExtractAbiFunction<
  typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY,
  'getProviderIdByAddress'
>

export type getProviderWithProduct = ExtractAbiFunction<
  typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY,
  'getProviderWithProduct'
>

export interface ServiceRegistryOptions {
  getProviderByAddress?: (args: AbiToType<getProviderByAddress['inputs']>) => AbiToType<getProviderByAddress['outputs']>
  getProviderIdByAddress?: (
    args: AbiToType<getProviderIdByAddress['inputs']>
  ) => AbiToType<getProviderIdByAddress['outputs']>
  getProvider?: (args: AbiToType<getProvider['inputs']>) => AbiToType<getProvider['outputs']>
  getProviderWithProduct?: (
    args: AbiToType<getProviderWithProduct['inputs']>
  ) => AbiToType<getProviderWithProduct['outputs']>
}

/**
 * Handle service provider registry calls
 */
export function serviceProviderRegistryCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY,
    data: data as Hex,
  })

  if (options.debug) {
    console.debug('Service Provider Registry: calling function', functionName, 'with args', args)
  }

  switch (functionName) {
    case 'getProviderByAddress': {
      if (!options.serviceRegistry?.getProviderByAddress) {
        throw new Error('Service Provider Registry: getProviderByAddress is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'getProviderByAddress'
        )!.outputs,
        options.serviceRegistry.getProviderByAddress(args)
      )
    }
    case 'getProviderIdByAddress': {
      if (!options.serviceRegistry?.getProviderIdByAddress) {
        throw new Error('Service Provider Registry: getProviderIdByAddress is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'getProviderIdByAddress'
        )!.outputs,
        options.serviceRegistry.getProviderIdByAddress(args)
      )
    }
    case 'getProvider': {
      if (!options.serviceRegistry?.getProvider) {
        throw new Error('Service Provider Registry: getProvider is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find((abi) => abi.type === 'function' && abi.name === 'getProvider')!
          .outputs,
        options.serviceRegistry.getProvider(args)
      )
    }
    case 'getProviderWithProduct': {
      if (!options.serviceRegistry?.getProviderWithProduct) {
        throw new Error('Service Provider Registry: getProviderWithProduct is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'getProviderWithProduct'
        )!.outputs,
        options.serviceRegistry.getProviderWithProduct(args)
      )
    }
    default: {
      throw new Error(`Service Provider Registry: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
