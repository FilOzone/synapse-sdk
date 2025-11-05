/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import { encodePDPCapabilities } from '@filoz/synapse-core/utils'
import type { PDPOffering, ServiceProviderInfo } from '@filoz/synapse-core/warm-storage'
import type { ExtractAbiFunction } from 'abitype'
import type { Hex } from 'viem'
import { decodeFunctionData, encodeAbiParameters, isAddressEqual } from 'viem'
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

export type getProvidersByProductType = ExtractAbiFunction<
  typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY,
  'getProvidersByProductType'
>

export type getAllActiveProviders = ExtractAbiFunction<
  typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY,
  'getAllActiveProviders'
>

export type getProviderCount = ExtractAbiFunction<typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY, 'getProviderCount'>

export type isProviderActive = ExtractAbiFunction<typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY, 'isProviderActive'>

export type isRegisteredProvider = ExtractAbiFunction<
  typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY,
  'isRegisteredProvider'
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
  getProvidersByProductType?: (
    args: AbiToType<getProvidersByProductType['inputs']>
  ) => AbiToType<getProvidersByProductType['outputs']>
  getAllActiveProviders?: (
    args: AbiToType<getAllActiveProviders['inputs']>
  ) => AbiToType<getAllActiveProviders['outputs']>
  getProviderCount?: (args: AbiToType<getProviderCount['inputs']>) => AbiToType<getProviderCount['outputs']>
  isProviderActive?: (args: AbiToType<isProviderActive['inputs']>) => AbiToType<isProviderActive['outputs']>
  isRegisteredProvider?: (args: AbiToType<isRegisteredProvider['inputs']>) => AbiToType<isRegisteredProvider['outputs']>
  REGISTRATION_FEE?: () => bigint
}

export type ServiceProviderInfoView = AbiToType<getProvider['outputs']>[0]
export type ProviderWithProduct = AbiToType<getProviderWithProduct['outputs']>[0]

export interface ProviderDecoded {
  providerId: bigint
  providerInfo: ServiceProviderInfo
  products: Array<
    | {
        productType: number
        isActive: boolean
        offering: PDPOffering
      }
    | undefined
  >
}

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

const _EMPTY_PROVIDER_WITH_PRODUCT: [ProviderWithProduct] = [
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

export function mockServiceProviderRegistry(providers: ProviderDecoded[]): ServiceRegistryOptions {
  const activeProviders = providers.filter((p) => p.providerInfo.isActive)
  return {
    getProvider: ([providerId]) => {
      const provider = providers.find((p) => p.providerId === providerId)
      if (!provider) {
        throw new Error('Provider not found')
      }
      return [
        {
          providerId,
          info: provider.providerInfo,
        },
      ]
    },
    getAllActiveProviders: ([offset, limit]) => {
      const providerIds = activeProviders.map((p) => p.providerId).slice(Number(offset), Number(offset + limit))
      const hasMore = offset + limit < activeProviders.length
      return [providerIds, hasMore]
    },
    getProviderCount: () => {
      return [BigInt(providers.length)]
    },
    isProviderActive: ([providerId]) => {
      const provider = providers.find((p) => p.providerId === providerId)
      return [provider?.providerInfo.isActive ?? false]
    },
    isRegisteredProvider: ([address]) => {
      const provider = providers.find((p) => isAddressEqual(address, p.providerInfo.serviceProvider))
      return [provider != null]
    },
    REGISTRATION_FEE: () => {
      return 0n
    },
    getProviderWithProduct: ([providerId, productType]) => {
      const provider = providers.find((p) => p.providerId === providerId)
      if (!provider) {
        throw new Error('Provider does not exist')
      }
      const product = provider.products.find((p) => p?.productType === productType)
      if (!product) {
        throw new Error('Service does not exist') // actual contract throws [none]
      }

      const [capabilityKeys, productCapabilityValues] = encodePDPCapabilities(product.offering)
      return [
        {
          providerId,
          providerInfo: provider.providerInfo,
          product: {
            productType: product.productType,
            capabilityKeys,
            isActive: product.isActive,
          },
          productCapabilityValues,
        },
      ]
    },
    getProvidersByProductType: ([productType, onlyActive, offset, limit]) => {
      if (!providers) {
        return [
          {
            providers: [] as ProviderWithProduct[],
            hasMore: false,
          },
        ]
      }

      const filteredProviders: ProviderWithProduct[] = []
      for (let i = 0; i < providers.length; i++) {
        const providerInfoView = providers[i]
        const providerId = providerInfoView.providerId
        const providerInfo = providers[i].providerInfo
        if (onlyActive && !providerInfo.isActive) {
          continue
        }
        const product = providers[i].products.find((p) => p?.productType === productType && p?.isActive)
        if (!product) {
          continue
        }
        const [capabilityKeys, productCapabilityValues] = encodePDPCapabilities(product.offering)
        filteredProviders.push({
          providerId,
          providerInfo,
          product: {
            productType: 0, // PDP
            capabilityKeys,
            isActive: product.isActive,
          },
          productCapabilityValues,
        })
      }
      const hasMore = offset + limit >= filteredProviders.length
      return [
        {
          providers: filteredProviders.slice(Number(offset), Number(offset + limit)),
          hasMore,
        },
      ]
    },
    getProviderByAddress: ([address]) => {
      for (const provider of providers) {
        if (address === provider.providerInfo.serviceProvider) {
          return [
            {
              providerId: provider.providerId,
              info: provider.providerInfo,
            },
          ]
        }
      }
      return [EMPTY_PROVIDER_INFO_VIEW]
    },
    getProviderIdByAddress: ([address]) => {
      for (const provider of providers) {
        if (address === provider.providerInfo.serviceProvider) {
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
    case 'getAllActiveProviders': {
      if (!options.serviceRegistry?.getAllActiveProviders) {
        throw new Error('Service Provider Registry: getAllActiveProviders is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'getAllActiveProviders'
        )!.outputs,
        options.serviceRegistry.getAllActiveProviders(args)
      )
    }
    case 'getProviderCount': {
      if (!options.serviceRegistry?.getProviderCount) {
        throw new Error('Service Provider Registry: getProviderCount is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'getProviderCount'
        )!.outputs,
        options.serviceRegistry.getProviderCount(args)
      )
    }
    case 'isProviderActive': {
      if (!options.serviceRegistry?.isProviderActive) {
        throw new Error('Service Provider Registry: isProviderActive is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'isProviderActive'
        )!.outputs,
        options.serviceRegistry.isProviderActive(args)
      )
    }
    case 'isRegisteredProvider': {
      if (!options.serviceRegistry?.isRegisteredProvider) {
        throw new Error('Service Provider Registry: isRegisteredProvider is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'isRegisteredProvider'
        )!.outputs,
        options.serviceRegistry.isRegisteredProvider(args)
      )
    }
    case 'REGISTRATION_FEE': {
      if (!options.serviceRegistry?.REGISTRATION_FEE) {
        throw new Error('Service Provider Registry: REGISTRATION_FEE is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'REGISTRATION_FEE'
        )!.outputs,
        [options.serviceRegistry.REGISTRATION_FEE()]
      )
    }
    default: {
      throw new Error(`Service Provider Registry: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
