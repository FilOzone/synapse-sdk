import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import { type Chain, type Client, type Hex, hexToString, type Transport } from 'viem'
import { readContract } from 'viem/actions'
import type * as Abis from '../abis/index.ts'
import { getChain } from '../chains.ts'

// Standard capability keys for PDP product type (must match ServiceProviderRegistry.sol REQUIRED_PDP_KEYS)
export const CAP_SERVICE_URL = 'serviceURL'
export const CAP_MIN_PIECE_SIZE = 'minPieceSizeInBytes'
export const CAP_MAX_PIECE_SIZE = 'maxPieceSizeInBytes'
export const CAP_IPNI_PIECE = 'ipniPiece' // Optional
export const CAP_IPNI_IPFS = 'ipniIpfs' // Optional
export const CAP_STORAGE_PRICE = 'storagePricePerTibPerDay'
export const CAP_MIN_PROVING_PERIOD = 'minProvingPeriodInEpochs'
export const CAP_LOCATION = 'location'
export const CAP_PAYMENT_TOKEN = 'paymentTokenAddress'

export type getProviderType = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProvider'>

export type ServiceProviderInfo = AbiParametersToPrimitiveTypes<getProviderType['outputs']>[0]['info']

export type PDPOffering = {
  serviceURL: string
  minPieceSizeInBytes: bigint
  maxPieceSizeInBytes: bigint
  ipniPiece: boolean
  ipniIpfs: boolean
  storagePricePerTibPerDay: bigint
  minProvingPeriodInEpochs: bigint
  location: string
  paymentTokenAddress: Hex
}

export interface PDPProvider extends ServiceProviderInfo {
  id: bigint
  pdp: PDPOffering
}

/**
 * Convert capability arrays to object map
 * @param keys - Array of capability keys
 * @param values - Array of capability values
 * @returns Object map of capabilities
 */
export function capabilitiesListToObject(keys: readonly string[], values: readonly Hex[]): Record<string, Hex> {
  const capabilities: Record<string, Hex> = {}
  for (let i = 0; i < keys.length; i++) {
    capabilities[keys[i]] = values[i]
  }
  return capabilities
}

/**
 * Decode PDP capabilities from keys/values arrays into a PDPOffering object.
 * Based on Curio's capabilitiesToOffering function.
 */
export function decodePDPCapabilities(capabilities: Record<string, Hex>): PDPOffering {
  return {
    serviceURL: hexToString(capabilities.serviceURL),
    minPieceSizeInBytes: BigInt(capabilities.minPieceSizeInBytes),
    maxPieceSizeInBytes: BigInt(capabilities.maxPieceSizeInBytes),
    ipniPiece: 'ipniPiece' in capabilities,
    ipniIpfs: 'ipniIpfs' in capabilities,
    storagePricePerTibPerDay: BigInt(capabilities.storagePricePerTibPerDay),
    minProvingPeriodInEpochs: BigInt(capabilities.minProvingPeriodInEpochs),
    location: hexToString(capabilities.location),
    paymentTokenAddress: capabilities.paymentTokenAddress,
  }
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
