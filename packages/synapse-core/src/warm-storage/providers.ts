import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import type { Simplify } from 'type-fest'
import { type Chain, type Client, decodeAbiParameters, type Transport } from 'viem'
import { readContract } from 'viem/actions'
import * as Abis from '../abis/index.ts'
import { getChain } from '../chains.ts'

export interface Provider extends ServiceProviderInfo {
  id: bigint
  product: ServiceProduct
}

export type PDPServiceProduct = Simplify<
  Omit<ServiceProduct, 'productData'> & {
    productData: PDPOffering
  }
>

export interface PDPProvider extends ServiceProviderInfo {
  id: bigint
  product: PDPServiceProduct
}

export type getProvidersByProductTypeType = ExtractAbiFunction<
  typeof Abis.serviceProviderRegistry,
  'getProvidersByProductType'
>

export type ContractProviderWithProduct = AbiParametersToPrimitiveTypes<
  getProvidersByProductTypeType['outputs']
>[0]['providers'][0]

type decodePDPOfferingType = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getPDPService'>
export type PDPOffering = AbiParametersToPrimitiveTypes<decodePDPOfferingType['outputs']>[0]

type getProviderType = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProvider'>

export type ServiceProviderInfo = AbiParametersToPrimitiveTypes<getProviderType['outputs']>[0]['info']
export type ServiceProduct = ContractProviderWithProduct['product']

// biome-ignore lint/style/noNonNullAssertion: its there
const PDPOfferingAbi = Abis.serviceProviderRegistry.find(
  (abi) => abi.type === 'function' && abi.name === 'getPDPService'
)!.outputs[0]

export function decodePDPOffering(data: `0x${string}`): PDPOffering {
  return decodeAbiParameters([PDPOfferingAbi], data)[0]
}

/**
 * Get the providers for the warm storage.
 *
 * @param client - The client to use.
 * @returns The providers.
 */
export async function readProviders(client: Client<Transport, Chain>): Promise<PDPProvider[]> {
  const chain = getChain(client.chain.id)

  const providersIds = await readContract(client, {
    address: chain.contracts.storageView.address,
    abi: chain.contracts.storageView.abi,
    functionName: 'getApprovedProviders',
    args: [0n, 100n],
  })

  const p = await readContract(client, {
    address: chain.contracts.serviceProviderRegistry.address,
    abi: chain.contracts.serviceProviderRegistry.abi,
    functionName: 'getActiveProvidersByProductType',
    args: [0, 0n, 100n],
  })

  const providers = [] as PDPProvider[]

  for (const provider of p.providers) {
    if (providersIds.includes(provider.providerId)) {
      providers.push({
        id: provider.providerId,
        ...provider.providerInfo,
        product: {
          ...provider.product,
          productData: decodePDPOffering(provider.product.productData),
        },
      })
    }
  }

  return providers
}
