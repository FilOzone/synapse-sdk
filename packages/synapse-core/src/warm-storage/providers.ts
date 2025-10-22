import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import { type Chain, type Client, decodeAbiParameters, type Transport } from 'viem'
import { readContract } from 'viem/actions'
import * as Abis from '../abis/index.ts'
import { getChain } from '../chains.ts'

export interface PDPProvider extends ServiceProviderInfo {
  pdp: PDPOffering
}

export type getProvidersByProductTypeType = ExtractAbiFunction<
  typeof Abis.serviceProviderRegistry,
  'getProvidersByProductType'
>

export type ProviderWithProduct = AbiParametersToPrimitiveTypes<
  getProvidersByProductTypeType['outputs']
>[0]['providers'][0]

export type decodePDPOfferingType = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'decodePDPOffering'>

export type getProviderType = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProvider'>

export type PDPOffering = AbiParametersToPrimitiveTypes<decodePDPOfferingType['outputs']>[0]

export type ServiceProviderInfo = AbiParametersToPrimitiveTypes<getProviderType['outputs']>[0]

// biome-ignore lint/style/noNonNullAssertion: its there
const PDPOfferingAbi = Abis.serviceProviderRegistry.find(
  (abi) => abi.type === 'function' && abi.name === 'decodePDPOffering'
)!.outputs

export function decodePDPOffering(data: `0x${string}`): PDPOffering {
  return decodeAbiParameters(PDPOfferingAbi, data)[0]
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
  })

  const p = await readContract(client, {
    address: chain.contracts.serviceProviderRegistry.address,
    abi: chain.contracts.serviceProviderRegistry.abi,
    functionName: 'getActiveProvidersByProductType',
    args: [0, 0n, 1000n],
  })

  const providers = [] as PDPProvider[]

  for (const provider of p.providers) {
    if (providersIds.includes(provider.providerId)) {
      providers.push({
        ...provider.providerInfo,
        providerId: provider.providerId,
        pdp: decodePDPOffering(provider.product.productData),
      })
    }
  }
  return providers
}
