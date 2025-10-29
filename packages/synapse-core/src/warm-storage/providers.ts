import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import { type Chain, type Client, hexToBigInt, hexToString, type Transport } from 'viem'
import { readContract } from 'viem/actions'
import type * as Abis from '../abis/index.ts'
import { getChain } from '../chains.ts'

// Standard capability keys for PDP product type (must match ServiceProviderRegistry.sol REQUIRED_PDP_KEYS)
const CAP_SERVICE_URL = 'serviceURL'
const CAP_MIN_PIECE_SIZE = 'minPieceSizeInBytes'
const CAP_MAX_PIECE_SIZE = 'maxPieceSizeInBytes'
const CAP_IPNI_PIECE = 'ipniPiece' // Optional
const CAP_IPNI_IPFS = 'ipniIpfs' // Optional
const CAP_STORAGE_PRICE = 'storagePricePerTibPerDay'
const CAP_MIN_PROVING_PERIOD = 'minProvingPeriodInEpochs'
const CAP_LOCATION = 'location'
const CAP_PAYMENT_TOKEN = 'paymentTokenAddress'

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
  paymentTokenAddress: `0x${string}`
}

export interface PDPProvider extends ServiceProviderInfo {
  id: bigint
  pdp: PDPOffering
}

/**
 * Decode PDP capabilities from keys/values arrays into a PDPOffering object.
 * Based on Curio's capabilitiesToOffering function.
 */
export function decodeCapabilities(keys: readonly string[], values: readonly `0x${string}`[]): PDPOffering {
  const offering: Partial<PDPOffering> = {
    ipniPiece: false,
    ipniIpfs: false,
  }

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = values[i]

    switch (key) {
      case CAP_SERVICE_URL:
        offering.serviceURL = hexToString(value)
        break
      case CAP_MIN_PIECE_SIZE:
        offering.minPieceSizeInBytes = hexToBigInt(value)
        break
      case CAP_MAX_PIECE_SIZE:
        offering.maxPieceSizeInBytes = hexToBigInt(value)
        break
      case CAP_IPNI_PIECE:
        offering.ipniPiece = value.length > 2 && value.slice(2, 4) === '01'
        break
      case CAP_IPNI_IPFS:
        offering.ipniIpfs = value.length > 2 && value.slice(2, 4) === '01'
        break
      case CAP_STORAGE_PRICE:
        offering.storagePricePerTibPerDay = hexToBigInt(value)
        break
      case CAP_MIN_PROVING_PERIOD:
        offering.minProvingPeriodInEpochs = hexToBigInt(value)
        break
      case CAP_LOCATION:
        offering.location = hexToString(value)
        break
      case CAP_PAYMENT_TOKEN:
        // Extract last 20 bytes for address
        if (value.length >= 42) {
          offering.paymentTokenAddress = `0x${value.slice(-40)}` as `0x${string}`
        }
        break
      // Ignore custom capabilities
    }
  }

  return offering as PDPOffering
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
        pdp: decodeCapabilities(provider.product.capabilityKeys, provider.productCapabilityValues),
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
    pdp: decodeCapabilities(provider.product.capabilityKeys, provider.productCapabilityValues),
  }
}
