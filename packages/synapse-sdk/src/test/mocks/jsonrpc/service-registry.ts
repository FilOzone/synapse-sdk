/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { PDPOffering } from '@filoz/synapse-core/utils'
import { encodePDPCapabilities } from '@filoz/synapse-core/utils'
import type { ExtractAbiFunction } from 'abitype'
import { assert } from 'chai'
import type { Hex } from 'viem'
import { decodeFunctionData, encodeAbiParameters } from 'viem'
import type { PDPServiceInfo } from '../../../sp-registry/types.ts'
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

export type ServiceProviderInfoView = AbiToType<getProvider['outputs']>[0]
export type ProviderWithProduct = AbiToType<getProviderWithProduct['outputs']>[0]

const EMPTY_PROVIDER_INFO = {
  serviceProvider: '0x0000000000000000000000000000000000000000',
  payee: '0x0000000000000000000000000000000000000000',
  name: '',
  description: '',
  isActive: false,
} as const

const EMPTY_PROVIDER_INFO_VIEW: ServiceProviderInfoView = {
  providerId: 0n,
  info: EMPTY_PROVIDER_INFO,
}

const EMPTY_PROVIDER_WITH_PRODUCT: [ProviderWithProduct] = [
  {
    providerId: 0n,
    providerInfo: EMPTY_PROVIDER_INFO,
    product: {
      productType: 0,
      capabilityKeys: [],
      isActive: false,
    },
    productCapabilityValues: [] as Hex[],
  },
]

export function mockServiceProviderRegistry(
  providers: ServiceProviderInfoView[],
  services?: (PDPServiceInfo | null)[]
): ServiceRegistryOptions {
  assert.isAtMost(services?.length ?? 0, providers.length)
  return {
    getProvider: ([providerId]) => {
      if (providerId < 0n || providerId > providers.length) {
        throw new Error('Provider does not exist')
      }
      for (const provider of providers) {
        if (providerId === provider.providerId) {
          return [provider]
        }
      }
      throw new Error('Provider not found')
    },
    getProviderWithProduct: ([providerId, productType]) => {
      if (!services) {
        return EMPTY_PROVIDER_WITH_PRODUCT
      }
      for (let i = 0; i < services.length; i++) {
        if (providers[i].providerId === providerId) {
          const providerInfo = providers[i].info
          const service = services[i]
          if (service == null) {
            return [
              {
                providerId,
                providerInfo,
                product: {
                  productType: 0,
                  capabilityKeys: [],
                  isActive: false,
                },
                productCapabilityValues: [] as Hex[],
              },
            ]
          }
          const [capabilityKeys, productCapabilityValues] = encodePDPCapabilities(service.offering)
          return [
            {
              providerId,
              providerInfo,
              product: {
                productType: 0, // PDP
                capabilityKeys,
                isActive: true,
              },
              productCapabilityValues,
            },
          ]
        }
      }
      return EMPTY_PROVIDER_WITH_PRODUCT
    },
    // TODO getProvidersByProductType
    getProviderByAddress: ([address]) => {
      for (const provider of providers) {
        if (address === provider.info.serviceProvider) {
          return [provider]
        }
      }
      return [EMPTY_PROVIDER_INFO_VIEW]
    },
    getProviderIdByAddress: ([address]) => {
      for (const provider of providers) {
        if (address === provider.info.serviceProvider) {
          return [provider.providerId]
        }
      }
      return [0n]
    },
  }
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
