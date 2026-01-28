import { base58btc } from 'multiformats/bases/base58'
import type { Hex } from 'viem'
import { bytesToHex, fromHex, hexToString, isHex, numberToBytes, stringToHex, toBytes } from 'viem'
import { z } from 'zod'
import { ZodValidationError } from '../errors/base.ts'
import type { PDPOffering, ProviderWithProduct } from '../sp-registry/types.ts'
import { capabilitiesListToObject, decodeAddressCapability } from './capabilities.ts'

const hex = z.custom<Hex>((val) => {
  return typeof val === 'string' ? isHex(val) : false
})

/**
 * Zod schema for PDP offering
 *
 * @see https://github.com/FilOzone/filecoin-services/blob/a86e4a5018133f17a25b4bb6b5b99da4d34fe664/service_contracts/src/ServiceProviderRegistry.sol#L14
 */
export const PDPOfferingSchema = z.object({
  serviceURL: hex,
  minPieceSizeInBytes: hex,
  maxPieceSizeInBytes: hex,
  storagePricePerTibPerDay: hex,
  minProvingPeriodInEpochs: hex,
  location: hex,
  paymentTokenAddress: hex,
  ipniPiece: hex.optional(),
  ipniIpfs: hex.optional(),
  ipniPeerId: hex.optional(),
})
// Standard capability keys for PDP product type (must match ServiceProviderRegistry.sol REQUIRED_PDP_KEYS)
export const CAP_SERVICE_URL = 'serviceURL'
export const CAP_MIN_PIECE_SIZE = 'minPieceSizeInBytes'
export const CAP_MAX_PIECE_SIZE = 'maxPieceSizeInBytes'
export const CAP_STORAGE_PRICE = 'storagePricePerTibPerDay'
export const CAP_MIN_PROVING_PERIOD = 'minProvingPeriodInEpochs'
export const CAP_LOCATION = 'location'
export const CAP_PAYMENT_TOKEN = 'paymentTokenAddress'
export const CAP_IPNI_PIECE = 'ipniPiece' // Optional (not validated by Bloom filter)
export const CAP_IPNI_IPFS = 'ipniIpfs' // Optional (not validated by Bloom filter)
export const CAP_IPNI_PEER_ID = 'ipniPeerId' // Optional (not validated by Bloom filter)
/** @deprecated Use CAP_IPNI_PEER_ID - kept for reading legacy entries */
export const CAP_IPNI_PEER_ID_LEGACY = 'IPNIPeerID'

export function decodePDPOffering(provider: ProviderWithProduct): PDPOffering {
  const capabilities = capabilitiesListToObject(provider.product.capabilityKeys, provider.productCapabilityValues)
  const parsed = PDPOfferingSchema.safeParse(capabilities)
  if (!parsed.success) {
    throw new ZodValidationError(parsed.error)
  }
  return decodePDPCapabilities(parsed.data)
}

/**
 * Decode PDP capabilities from keys/values arrays into a PDPOffering object.
 * Based on Curio's capabilitiesToOffering function.
 */
export function decodePDPCapabilities(capabilities: Record<string, Hex>): PDPOffering {
  const required = {
    serviceURL: hexToString(capabilities.serviceURL),
    minPieceSizeInBytes: BigInt(capabilities.minPieceSizeInBytes),
    maxPieceSizeInBytes: BigInt(capabilities.maxPieceSizeInBytes),
    storagePricePerTibPerDay: BigInt(capabilities.storagePricePerTibPerDay),
    minProvingPeriodInEpochs: BigInt(capabilities.minProvingPeriodInEpochs),
    location: hexToString(capabilities.location),
    paymentTokenAddress: decodeAddressCapability(capabilities.paymentTokenAddress),
    ipniPiece: 'ipniPiece' in capabilities,
    ipniIpfs: 'ipniIpfs' in capabilities,
    ipniPeerID:
      CAP_IPNI_PEER_ID in capabilities ? base58btc.encode(fromHex(capabilities[CAP_IPNI_PEER_ID], 'bytes')) : undefined,
  }
  const optional = {
    ipniPiece: CAP_IPNI_PIECE in capabilities ? capabilities[CAP_IPNI_PIECE] === '0x01' : false,
    ipniIpfs: CAP_IPNI_IPFS in capabilities ? capabilities[CAP_IPNI_IPFS] === '0x01' : false,
    ipniPeerId:
      CAP_IPNI_PEER_ID in capabilities
        ? base58btc.encode(fromHex(capabilities[CAP_IPNI_PEER_ID], 'bytes'))
        : CAP_IPNI_PEER_ID_LEGACY in capabilities
          ? base58btc.encode(fromHex(capabilities[CAP_IPNI_PEER_ID_LEGACY], 'bytes'))
          : undefined,
  }
  return { ...required, ...optional }
}

/**
 * Encode PDP capabilities from a PDPOffering object and a capabilities object into a capability keys and values array.
 *
 * @todo add zod schema validation for the pdp offering and capabilities.
 *
 * @param pdpOffering - The PDP offering to encode.
 * @param capabilities - The capabilities to encode.
 * @returns The encoded capability keys and values.
 */
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
