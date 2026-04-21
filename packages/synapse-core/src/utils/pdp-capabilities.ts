import { base58btc } from 'multiformats/bases/base58'
import type { Hex } from 'viem'
import { bytesToHex, fromHex, hexToString, isHex, numberToBytes, stringToHex, toBytes } from 'viem'
import { z } from 'zod'
import { ValidationError, ZodValidationError } from '../errors/base.ts'
import type { PDPOffering, ProviderWithProduct } from '../sp-registry/types.ts'
import { capabilitiesListToObject, decodeAddressCapability } from './capabilities.ts'
import { zHex } from './schemas.ts'

/**
 * Zod schema for PDP offering
 *
 * @see https://github.com/FilOzone/filecoin-services/blob/a86e4a5018133f17a25b4bb6b5b99da4d34fe664/service_contracts/src/ServiceProviderRegistry.sol#L14
 */
export const PDPOfferingSchema = z
  .object({
    serviceURL: zHex,
    minPieceSizeInBytes: zHex,
    maxPieceSizeInBytes: zHex,
    storagePricePerTibPerDay: zHex,
    minProvingPeriodInEpochs: zHex,
    location: zHex,
    paymentTokenAddress: zHex,
    ipniPiece: zHex.optional(),
    ipniIpfs: zHex.optional(),
    ipniPeerId: zHex.optional(),
  })
  .catchall(zHex)
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

/**
 * Reserved PDP capability keys that `encodePDPCapabilities` writes itself.
 *
 * User-supplied `capabilities` whose key appears in this set are rejected to
 * avoid desyncing the on-chain capability array (which keeps duplicates) from
 * the capability-value mapping (last-write-wins).
 */
export const RESERVED_PDP_CAPABILITY_KEYS: ReadonlySet<string> = new Set([
  CAP_SERVICE_URL,
  CAP_MIN_PIECE_SIZE,
  CAP_MAX_PIECE_SIZE,
  CAP_STORAGE_PRICE,
  CAP_MIN_PROVING_PERIOD,
  CAP_LOCATION,
  CAP_PAYMENT_TOKEN,
  CAP_IPNI_PIECE,
  CAP_IPNI_IPFS,
  CAP_IPNI_PEER_ID,
  CAP_IPNI_PEER_ID_LEGACY,
])

export function decodePDPOffering(provider: ProviderWithProduct): PDPOffering {
  const capabilities = capabilitiesListToObject(provider.product.capabilityKeys, provider.productCapabilityValues)
  const parsed = PDPOfferingSchema.safeParse(capabilities)
  if (!parsed.success) {
    throw new ZodValidationError(parsed.error)
  }
  return decodePDPCapabilities(parsed.data)
}

/** Capability keys that are decoded into typed PDPOffering fields, derived from the schema */
const KNOWN_CAPABILITY_KEYS = new Set([...Object.keys(PDPOfferingSchema.shape), CAP_IPNI_PEER_ID_LEGACY])

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

  const extraCapabilities: Record<string, Hex> = Object.create(null)
  for (const key of Object.keys(capabilities)) {
    if (!KNOWN_CAPABILITY_KEYS.has(key)) {
      extraCapabilities[key] = capabilities[key]
    }
  }

  return { ...required, ...optional, extraCapabilities }
}

/**
 * Encode a {@link PDPOffering} plus optional user-supplied extras into the
 * `(keys[], values[])` tuple consumed by `registerProvider` / `addProduct` /
 * `updateProduct` on `ServiceProviderRegistry`.
 *
 * Behavior notes:
 * - Reserved PDP keys (see {@link RESERVED_PDP_CAPABILITY_KEYS}) cannot be
 *   passed via `capabilities`; they are written from `pdpOffering`. A collision
 *   would desync the contract's capability-keys array (duplicates kept) from
 *   the capability-value mapping (last-wins).
 * - `capabilities` values are hex-encoded verbatim if they already look like
 *   hex (e.g. `'0x01'` for a flag byte), otherwise UTF-8-encoded. Empty
 *   strings are rejected — callers that want a flag byte must pass `'0x01'`
 *   explicitly instead of `''`.
 *
 * Total-count and per-entry byte-length limits are enforced by
 * `validateCapabilities` at each `*Call` site, so they are not re-checked here.
 *
 * @param pdpOffering - The PDP offering to encode.
 * @param capabilities - Optional non-reserved extra capabilities.
 * @returns A `[keys, values]` tuple ready for the contract call.
 * @throws Errors {@link ValidationError} when `capabilities` contains a reserved PDP key or an empty value
 */
export function encodePDPCapabilities(
  pdpOffering: PDPOffering,
  capabilities?: Record<string, string>
): [string[], Hex[]] {
  const capabilityKeys: string[] = []
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
      if (RESERVED_PDP_CAPABILITY_KEYS.has(key)) {
        throw new ValidationError(
          `Capability key "${key}" is reserved for the PDP offering and cannot be passed via \`capabilities\`. Set it on \`pdpOffering\` instead.`
        )
      }
      if (value === '') {
        throw new ValidationError(
          `Capability "${key}" has an empty value. Pass "0x01" (or any explicit hex) for a flag byte.`
        )
      }
      capabilityKeys.push(key)
      capabilityValues.push(isHex(value) ? value : bytesToHex(toBytes(value)))
    }
  }

  return [capabilityKeys, capabilityValues]
}
