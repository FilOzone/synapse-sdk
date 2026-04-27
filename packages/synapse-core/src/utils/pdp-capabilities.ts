import { base58btc } from 'multiformats/bases/base58'
import type { Hex } from 'viem'
import { bytesToHex, fromHex, hexToString, isHex, numberToBytes, stringToHex, toBytes } from 'viem'
import { z } from 'zod'
import { ValidationError, ZodValidationError } from '../errors/base.ts'
import type { PDPOffering, ProviderWithProduct } from '../sp-registry/types.ts'
import { capabilitiesListToObject, decodeAddressCapability } from './capabilities.ts'
import { PDP_OFFERING_KEYS, PDP_OFFERING_KEYS_SET } from './constants.ts'
import { zHex } from './schemas.ts'

/**
 * Zod schema for PDP offering
 *
 * @see https://github.com/FilOzone/filecoin-services/blob/a86e4a5018133f17a25b4bb6b5b99da4d34fe664/service_contracts/src/ServiceProviderRegistry.sol#L14
 */
export const PDPOfferingSchema = z
  .object({
    [PDP_OFFERING_KEYS.SERVICE_URL]: zHex,
    [PDP_OFFERING_KEYS.MIN_PIECE_SIZE]: zHex,
    [PDP_OFFERING_KEYS.MAX_PIECE_SIZE]: zHex,
    [PDP_OFFERING_KEYS.STORAGE_PRICE]: zHex,
    [PDP_OFFERING_KEYS.MIN_PROVING_PERIOD]: zHex,
    [PDP_OFFERING_KEYS.LOCATION]: zHex,
    [PDP_OFFERING_KEYS.PAYMENT_TOKEN]: zHex,
    [PDP_OFFERING_KEYS.IPNI_PIECE]: zHex.optional(),
    [PDP_OFFERING_KEYS.IPNI_IPFS]: zHex.optional(),
    [PDP_OFFERING_KEYS.IPNI_PEER_ID]: zHex.optional(),
  })
  .catchall(zHex)

/**
 * Decode the PDP offering from the provider.
 *
 * @param provider - The provider to decode the offering for. {@link ProviderWithProduct}
 * @returns The decoded offering.
 * @throws Errors {@link ZodValidationError} when the capabilities are invalid.
 */
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
  }
  const optional = {
    ipniPiece:
      PDP_OFFERING_KEYS.IPNI_PIECE in capabilities ? capabilities[PDP_OFFERING_KEYS.IPNI_PIECE] === '0x01' : false,
    ipniIpfs:
      PDP_OFFERING_KEYS.IPNI_IPFS in capabilities ? capabilities[PDP_OFFERING_KEYS.IPNI_IPFS] === '0x01' : false,
    ipniPeerId:
      PDP_OFFERING_KEYS.IPNI_PEER_ID in capabilities
        ? base58btc.encode(fromHex(capabilities[PDP_OFFERING_KEYS.IPNI_PEER_ID], 'bytes'))
        : PDP_OFFERING_KEYS.IPNI_PEER_ID_LEGACY in capabilities
          ? base58btc.encode(fromHex(capabilities[PDP_OFFERING_KEYS.IPNI_PEER_ID_LEGACY], 'bytes'))
          : undefined,
  }

  const extraCapabilities: Record<string, Hex> = Object.create(null)
  for (const key of Object.keys(capabilities)) {
    if (!PDP_OFFERING_KEYS_SET.has(key as any)) {
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
 * - Reserved PDP keys (see {@link PDP_OFFERING_KEYS_SET}) cannot be
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

  capabilityKeys.push(PDP_OFFERING_KEYS.SERVICE_URL)
  capabilityValues.push(stringToHex(pdpOffering.serviceURL))
  capabilityKeys.push(PDP_OFFERING_KEYS.MIN_PIECE_SIZE)
  capabilityValues.push(bytesToHex(numberToBytes(pdpOffering.minPieceSizeInBytes)))
  capabilityKeys.push(PDP_OFFERING_KEYS.MAX_PIECE_SIZE)
  capabilityValues.push(bytesToHex(numberToBytes(pdpOffering.maxPieceSizeInBytes)))
  if (pdpOffering.ipniPiece) {
    capabilityKeys.push(PDP_OFFERING_KEYS.IPNI_PIECE)
    capabilityValues.push('0x01')
  }
  if (pdpOffering.ipniIpfs) {
    capabilityKeys.push(PDP_OFFERING_KEYS.IPNI_IPFS)
    capabilityValues.push('0x01')
  }
  capabilityKeys.push(PDP_OFFERING_KEYS.STORAGE_PRICE)
  capabilityValues.push(bytesToHex(numberToBytes(pdpOffering.storagePricePerTibPerDay)))
  capabilityKeys.push(PDP_OFFERING_KEYS.MIN_PROVING_PERIOD)
  capabilityValues.push(bytesToHex(numberToBytes(pdpOffering.minProvingPeriodInEpochs)))
  capabilityKeys.push(PDP_OFFERING_KEYS.LOCATION)
  capabilityValues.push(stringToHex(pdpOffering.location))
  capabilityKeys.push(PDP_OFFERING_KEYS.PAYMENT_TOKEN)
  capabilityValues.push(pdpOffering.paymentTokenAddress)

  if (capabilities != null) {
    for (const [key, value] of Object.entries(capabilities)) {
      if (PDP_OFFERING_KEYS_SET.has(key as any)) {
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
