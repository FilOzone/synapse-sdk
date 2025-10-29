import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import type { Chain, Client, Hex, Transport } from 'viem'
import { bytesToHex, hexToString, isHex, numberToBytes, stringToHex, toBytes } from 'viem'
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

export function encodePDPCapabilities(
  pdpOffering: PDPOffering,
  capabilities?: Record<string, string>
): [string[], Hex[]] {
  const capabilityKeys = []
  const capabilityValues: Hex[] = []

  capabilityKeys.push(CAP_SERVICE_URL)
  capabilityValues.push(stringToHex(pdpOffering.serviceURL))
  capabilityKeys.push(CAP_MIN_PIECE_SIZE)
  capabilityValues.push(bytesToHex(numberToBytes(pdpOffering.minPieceSizeInBytes)))
  capabilityKeys.push(CAP_MAX_PIECE_SIZE)
  capabilityValues.push(bytesToHex(numberToBytes(pdpOffering.maxPieceSizeInBytes)))
  if (pdpOffering.ipniPiece) {
    capabilityKeys.push(CAP_IPNI_PIECE)
    capabilityValues.push('0x01')
  }
  if (pdpOffering.ipniIpfs) {
    capabilityKeys.push(CAP_IPNI_IPFS)
    capabilityValues.push('0x01')
  }
  capabilityKeys.push(CAP_STORAGE_PRICE)
  capabilityValues.push(bytesToHex(numberToBytes(pdpOffering.storagePricePerTibPerDay)))
  capabilityKeys.push(CAP_MIN_PROVING_PERIOD)
  capabilityValues.push(bytesToHex(numberToBytes(pdpOffering.minProvingPeriodInEpochs)))
  capabilityKeys.push(CAP_LOCATION)
  capabilityValues.push(stringToHex(pdpOffering.location))
  capabilityKeys.push(CAP_PAYMENT_TOKEN)
  capabilityValues.push(pdpOffering.paymentTokenAddress)

  if (capabilities != null) {
    for (const [key, value] of Object.entries(capabilities)) {
      capabilityKeys.push(key)
      if (!value) {
        capabilityValues.push('0x01')
      } else if (isHex(value)) {
        capabilityValues.push(value)
      } else {
        capabilityValues.push(bytesToHex(toBytes(value)))
      }
    }
  }

  return [capabilityKeys, capabilityValues]
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
