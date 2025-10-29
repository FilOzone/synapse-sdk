import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import type { Hex } from 'viem'
import { bytesToHex, hexToString, isHex, numberToBytes, stringToHex, toBytes } from 'viem'

import type * as Abis from '../abis/index.ts'
import { decodeAddressCapability } from './capabilities.ts'

export type getProviderType = ExtractAbiFunction<typeof Abis.serviceProviderRegistry, 'getProvider'>

export type ServiceProviderInfo = AbiParametersToPrimitiveTypes<getProviderType['outputs']>[0]['info']

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

/**
 * PDP offering details (decoded from capability k/v pairs)
 */
export interface PDPOffering {
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
    paymentTokenAddress: decodeAddressCapability(capabilities.paymentTokenAddress),
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
