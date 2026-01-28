/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import { encodePDPCapabilities } from '@filoz/synapse-core/utils'
import type { ExtractAbiFunction } from 'abitype'
import type { Address } from 'ox/Address'
import type { Hex } from 'viem'
import { decodeFunctionData, encodeAbiParameters, isAddressEqual } from 'viem'
import * as Abis from '../../abis/index.ts'
import type { PDPOffering, ProviderInfo } from '../../sp-registry/types.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type getProviderByAddress = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProviderByAddress'>

export type getProvider = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProvider'>

export type getProviderIdByAddress = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProviderIdByAddress'>

export type getProviderWithProduct = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProviderWithProduct'>

export type getProvidersByProductType = ExtractAbiFunction<
  typeof Abis.serviceProviderRegistry,
  'getProvidersByProductType'
>

export type getAllActiveProviders = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getAllActiveProviders'>

export type getProviderCount = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProviderCount'>

export type activeProviderCount = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'activeProviderCount'>

export type isProviderActive = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'isProviderActive'>

export type isRegisteredProvider = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'isRegisteredProvider'>

export type registerProvider = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'registerProvider'>

export type updateProviderInfo = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'updateProviderInfo'>

export type removeProvider = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'removeProvider'>

export type addProduct = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'addProduct'>

export type updateProduct = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'updateProduct'>

export type removeProduct = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'removeProduct'>

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
  activeProviderCount?: (args: AbiToType<activeProviderCount['inputs']>) => AbiToType<activeProviderCount['outputs']>
  isProviderActive?: (args: AbiToType<isProviderActive['inputs']>) => AbiToType<isProviderActive['outputs']>
  isRegisteredProvider?: (args: AbiToType<isRegisteredProvider['inputs']>) => AbiToType<isRegisteredProvider['outputs']>
  REGISTRATION_FEE?: () => bigint
  registerProvider?: (
    args: AbiToType<registerProvider['inputs']>,
    value: Hex,
    from: Address
  ) => AbiToType<registerProvider['outputs']>
  updateProviderInfo?: (
    args: AbiToType<updateProviderInfo['inputs']>,
    value: Hex,
    from: Address
  ) => AbiToType<updateProviderInfo['outputs']>
  removeProvider?: (
    args: AbiToType<removeProvider['inputs']>,
    value: Hex,
    from: Address
  ) => AbiToType<removeProvider['outputs']>
  addProduct?: (args: AbiToType<addProduct['inputs']>, value: Hex, from: Address) => AbiToType<addProduct['outputs']>
  updateProduct?: (
    args: AbiToType<updateProduct['inputs']>,
    value: Hex,
    from: Address
  ) => AbiToType<updateProduct['outputs']>
  removeProduct?: (
    args: AbiToType<removeProduct['inputs']>,
    value: Hex,
    from: Address
  ) => AbiToType<removeProduct['outputs']>
}

type ServiceProviderInfoView = AbiToType<getProvider['outputs']>[0]
export type ProviderWithProduct = AbiToType<getProviderWithProduct['outputs']>[0]

export interface ProviderDecoded {
  providerId: bigint
  providerInfo: ProviderInfo
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
    activeProviderCount: () => {
      return [BigInt(activeProviders.length)]
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
        throw new Error('Provider not found')
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
      const hasMore = Number(offset + limit) < filteredProviders.length
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
export function serviceProviderRegistryCallHandler(data: Hex, value: Hex, from: Address, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: Abis.serviceProviderRegistry,
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
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'getProviderByAddress')!
          .outputs,
        options.serviceRegistry.getProviderByAddress(args)
      )
    }
    case 'getProviderIdByAddress': {
      if (!options.serviceRegistry?.getProviderIdByAddress) {
        throw new Error('Service Provider Registry: getProviderIdByAddress is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'getProviderIdByAddress')!
          .outputs,
        options.serviceRegistry.getProviderIdByAddress(args)
      )
    }
    case 'getProvider': {
      if (!options.serviceRegistry?.getProvider) {
        throw new Error('Service Provider Registry: getProvider is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'getProvider')!.outputs,
        options.serviceRegistry.getProvider(args)
      )
    }
    case 'getProviderWithProduct': {
      if (!options.serviceRegistry?.getProviderWithProduct) {
        throw new Error('Service Provider Registry: getProviderWithProduct is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'getProviderWithProduct')!
          .outputs,
        options.serviceRegistry.getProviderWithProduct(args)
      )
    }
    case 'getProvidersByProductType': {
      if (!options.serviceRegistry?.getProvidersByProductType) {
        throw new Error('Service Provider Registry: getProvidersByProductType is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'getProvidersByProductType')!
          .outputs,
        options.serviceRegistry.getProvidersByProductType(args)
      )
    }
    case 'getAllActiveProviders': {
      if (!options.serviceRegistry?.getAllActiveProviders) {
        throw new Error('Service Provider Registry: getAllActiveProviders is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'getAllActiveProviders')!
          .outputs,
        options.serviceRegistry.getAllActiveProviders(args)
      )
    }
    case 'getProviderCount': {
      if (!options.serviceRegistry?.getProviderCount) {
        throw new Error('Service Provider Registry: getProviderCount is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'getProviderCount')!.outputs,
        options.serviceRegistry.getProviderCount(args)
      )
    }
    case 'activeProviderCount': {
      if (!options.serviceRegistry?.activeProviderCount) {
        throw new Error('Service Provider Registry: activeProviderCount is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'activeProviderCount')!
          .outputs,
        options.serviceRegistry.activeProviderCount(args)
      )
    }
    case 'isProviderActive': {
      if (!options.serviceRegistry?.isProviderActive) {
        throw new Error('Service Provider Registry: isProviderActive is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'isProviderActive')!.outputs,
        options.serviceRegistry.isProviderActive(args)
      )
    }
    case 'isRegisteredProvider': {
      if (!options.serviceRegistry?.isRegisteredProvider) {
        throw new Error('Service Provider Registry: isRegisteredProvider is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'isRegisteredProvider')!
          .outputs,
        options.serviceRegistry.isRegisteredProvider(args)
      )
    }
    case 'REGISTRATION_FEE': {
      if (!options.serviceRegistry?.REGISTRATION_FEE) {
        throw new Error('Service Provider Registry: REGISTRATION_FEE is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'REGISTRATION_FEE')!.outputs,
        [options.serviceRegistry.REGISTRATION_FEE()]
      )
    }
    case 'registerProvider': {
      if (!options.serviceRegistry?.registerProvider) {
        throw new Error('Service Provider Registry: registerProvider is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'registerProvider')!.outputs,
        options.serviceRegistry.registerProvider(args, value, from)
      )
    }
    case 'updateProviderInfo': {
      if (!options.serviceRegistry?.updateProviderInfo) {
        throw new Error('Service Provider Registry: updateProviderInfo is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'updateProviderInfo')!
          .outputs,
        options.serviceRegistry.updateProviderInfo(args, value, from)
      )
    }
    case 'removeProvider': {
      if (!options.serviceRegistry?.removeProvider) {
        throw new Error('Service Provider Registry: removeProvider is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'removeProvider')!.outputs,
        options.serviceRegistry.removeProvider(args, value, from)
      )
    }
    case 'addProduct': {
      if (!options.serviceRegistry?.addProduct) {
        throw new Error('Service Provider Registry: addProduct is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'addProduct')!.outputs,
        options.serviceRegistry.addProduct(args, value, from)
      )
    }
    case 'updateProduct': {
      if (!options.serviceRegistry?.updateProduct) {
        throw new Error('Service Provider Registry: updateProduct is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'updateProduct')!.outputs,
        options.serviceRegistry.updateProduct(args, value, from)
      )
    }
    case 'removeProduct': {
      if (!options.serviceRegistry?.removeProduct) {
        throw new Error('Service Provider Registry: removeProduct is not defined')
      }
      return encodeAbiParameters(
        Abis.serviceProviderRegistry.find((abi) => abi.type === 'function' && abi.name === 'removeProduct')!.outputs,
        options.serviceRegistry.removeProduct(args, value, from)
      )
    }
    default: {
      throw new Error(`Service Provider Registry: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
