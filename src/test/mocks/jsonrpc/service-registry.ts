/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import { ADDRESSES, type JSONRPCOptions } from './index.ts'

export type ProviderInfo = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY, 'getProviderByAddress'>['outputs']
>

export type PDPOffering = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY, 'getPDPService'>['outputs']
>

export type getProviderInput = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY, 'getProvider'>['inputs']
>

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
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'getProviderByAddress'
        )!.outputs,
        options.serviceRegistry?.getProviderByAddress ?? [
          {
            serviceProvider: ADDRESSES.serviceProvider1,
            payee: ADDRESSES.payee1,
            name: 'Test Provider',
            description: 'Test Provider Description',
            isActive: true,
          },
        ]
      )
    }
    case 'getProviderIdByAddress': {
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find(
          (abi) => abi.type === 'function' && abi.name === 'getProviderIdByAddress'
        )!.outputs,
        [options.serviceRegistry?.getProviderIdByAddress ?? BigInt(1)]
      )
    }
    case 'getPDPService': {
      const defaultPDPService: PDPOffering = [
        {
          serviceURL: 'https://pdp.example.com',
          minPieceSizeInBytes: BigInt(1024),
          maxPieceSizeInBytes: BigInt(1024 * 1024 * 1024),
          ipniPiece: false,
          ipniIpfs: false,
          storagePricePerTibPerMonth: 1000000n,
          minProvingPeriodInEpochs: 2880n,
          location: 'US',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
        [],
        true,
      ]
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find((abi) => abi.type === 'function' && abi.name === 'getPDPService')!
          .outputs,
        options.serviceRegistry?.getPDPService ?? defaultPDPService
      )
    }
    case 'getProvider': {
      return encodeAbiParameters(
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY.find((abi) => abi.type === 'function' && abi.name === 'getProvider')!
          .outputs,
        options.serviceRegistry?.getProvider?.(args as getProviderInput) ?? [
          {
            serviceProvider: ADDRESSES.serviceProvider1,
            payee: ADDRESSES.payee1,
            name: 'Test Provider',
            description: 'Test Provider Description',
            isActive: true,
          },
        ]
      )
    }
    default: {
      throw new Error(`Service Provider Registry: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
