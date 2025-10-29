import type { Chain, Client, Transport } from 'viem'
import { readContract } from 'viem/actions'
import { getChain } from '../chains.ts'
import { capabilitiesListToObject } from '../utils/capabilities.ts'
import type { PDPProvider } from '../utils/pdp-capabilities.ts'
import { decodePDPCapabilities } from '../utils/pdp-capabilities.ts'

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
    args: [0n, 1000n], // offset, limit
  })

  const p = await readContract(client, {
    address: chain.contracts.serviceProviderRegistry.address,
    abi: chain.contracts.serviceProviderRegistry.abi,
    functionName: 'getProvidersByProductType',
    args: [0, true, 0n, 1000n], // productType (PDP=0), onlyActive, offset, limit
  })

  const providers = [] as PDPProvider[]

  for (const provider of p.providers) {
    if (providersIds.includes(provider.providerId)) {
      providers.push({
        id: provider.providerId,
        ...provider.providerInfo,
        pdp: decodePDPCapabilities(
          capabilitiesListToObject(provider.product.capabilityKeys, provider.productCapabilityValues)
        ),
      })
    }
  }
  return providers
}

export type GetProviderOptions = {
  providerId: bigint
}

export async function getProvider(client: Client<Transport, Chain>, options: GetProviderOptions): Promise<PDPProvider> {
  const chain = getChain(client.chain.id)
  const provider = await readContract(client, {
    address: chain.contracts.serviceProviderRegistry.address,
    abi: chain.contracts.serviceProviderRegistry.abi,
    functionName: 'getProviderWithProduct',
    args: [options.providerId, 0], // productType PDP = 0
  })
  return {
    id: provider.providerId,
    ...provider.providerInfo,
    pdp: decodePDPCapabilities(
      capabilitiesListToObject(provider.product.capabilityKeys, provider.productCapabilityValues)
    ),
  }
}
