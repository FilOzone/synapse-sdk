import { type Address, type Hex, isAddressEqual, size, zeroAddress } from 'viem'
import { ValidationError } from '../errors/base.ts'
import { SERVICE_PROVIDER_REGISTRY as spRegistry } from '../utils/constants.ts'
import { PRODUCTS, type ProductType } from './types.ts'

const textEncoder = new TextEncoder()

/** UTF-8 byte length of a string — the unit the on-chain `require`s count. */
function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).length
}

/**
 * Validate `ServiceProviderInfo.name` / `description` byte lengths against the
 * on-chain `MAX_NAME_LENGTH` / `MAX_DESCRIPTION_LENGTH` require checks.
 *
 * @throws Errors {@link ValidationError} when either field exceeds its limit
 */
export function validateProviderInfo(options: { name: string; description: string }): void {
  const nameBytes = utf8ByteLength(options.name)
  if (nameBytes > spRegistry.MAX_NAME_LENGTH) {
    throw new ValidationError(`Provider name is too long: ${nameBytes} bytes, max ${spRegistry.MAX_NAME_LENGTH} bytes`)
  }
  const descriptionBytes = utf8ByteLength(options.description)
  if (descriptionBytes > spRegistry.MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `Provider description is too long: ${descriptionBytes} bytes, max ${spRegistry.MAX_DESCRIPTION_LENGTH} bytes`
    )
  }
}

/**
 * Validate the `payee` address for `registerProvider`.
 *
 * On-chain: `require(payee != address(0), "Payee cannot be zero address")`.
 *
 * @throws Errors {@link ValidationError} when `payee` is the zero address
 */
export function validatePayee(payee: Address): void {
  if (isAddressEqual(payee, zeroAddress)) {
    throw new ValidationError('Payee cannot be the zero address')
  }
}

/**
 * Validate that `productType` is the currently supported `ProductType.PDP` (0).
 *
 * On-chain: `require(productType == ProductType.PDP, "Only PDP product type currently supported")`.
 *
 * @throws Errors {@link ValidationError} when `productType` is anything other than `PRODUCTS.PDP`
 */
export function validateProductType(productType: number): asserts productType is ProductType {
  if (productType !== PRODUCTS.PDP) {
    throw new ValidationError(
      `Unsupported productType: ${productType}. Only PDP (${PRODUCTS.PDP}) is currently supported.`
    )
  }
}

/**
 * Defensive check for the `location` capability value byte length.
 *
 * The on-chain `MAX_LOCATION_LENGTH = 128` constant is declared but not
 * individually enforced — the stricter `MAX_CAPABILITY_VALUE_LENGTH = 128`
 * covers it transitively. Kept here to surface a clear error before the
 * value is hex-encoded into a capability entry.
 *
 * @throws Errors {@link ValidationError} when `location` exceeds `SERVICE_PROVIDER_REGISTRY.MAX_LOCATION_LENGTH`
 */
export function validateLocation(location: string): void {
  const bytes = utf8ByteLength(location)
  if (bytes > spRegistry.MAX_LOCATION_LENGTH) {
    throw new ValidationError(`Location is too long: ${bytes} bytes, max ${spRegistry.MAX_LOCATION_LENGTH} bytes`)
  }
}

/**
 * Validate capability keys/values arrays against the contract's
 * `_validateCapabilities` require chain.
 *
 * Checks:
 * - `keys.length === values.length`
 * - `keys.length <= MAX_CAPABILITIES` (24)
 * - each key non-empty and `<= MAX_CAPABILITY_KEY_LENGTH` (32 UTF-8 bytes)
 * - each value non-empty and `<= MAX_CAPABILITY_VALUE_LENGTH` (128 bytes)
 *
 * @throws Errors {@link ValidationError} when any of the above is violated
 */
export function validateCapabilities(keys: readonly string[], values: readonly Hex[]): void {
  if (keys.length !== values.length) {
    throw new ValidationError(
      `Capability keys and values must have the same length: ${keys.length} keys vs ${values.length} values`
    )
  }
  if (keys.length > spRegistry.MAX_CAPABILITIES) {
    throw new ValidationError(`Too many capabilities: ${keys.length}, max ${spRegistry.MAX_CAPABILITIES}`)
  }
  for (let i = 0; i < keys.length; i++) {
    const keyBytes = utf8ByteLength(keys[i])
    if (keyBytes === 0) {
      throw new ValidationError(`Capability key at index ${i} cannot be empty`)
    }
    if (keyBytes > spRegistry.MAX_CAPABILITY_KEY_LENGTH) {
      throw new ValidationError(
        `Capability key at index ${i} is too long: ${keyBytes} bytes, max ${spRegistry.MAX_CAPABILITY_KEY_LENGTH} bytes`
      )
    }
    const valueBytes = size(values[i])
    if (valueBytes === 0) {
      throw new ValidationError(`Capability value at index ${i} (key "${keys[i]}") cannot be empty`)
    }
    if (valueBytes > spRegistry.MAX_CAPABILITY_VALUE_LENGTH) {
      throw new ValidationError(
        `Capability value at index ${i} (key "${keys[i]}") is too long: ${valueBytes} bytes, max ${spRegistry.MAX_CAPABILITY_VALUE_LENGTH} bytes`
      )
    }
  }
}

/**
 * Validate the `value` (msg.value) passed to `registerProvider` against
 * `SERVICE_PROVIDER_REGISTRY.REGISTRATION_FEE_WEI` so callers get a client-side
 * error instead of a simulate revert.
 *
 * The value is mirrored from `ServiceProviderRegistry.sol`. If the contract
 * upgrades and changes the fee, callers should omit `value` and let the SDK
 * fetch the live `REGISTRATION_FEE()` instead.
 *
 * @throws Errors {@link ValidationError} when `value !== SERVICE_PROVIDER_REGISTRY.REGISTRATION_FEE_WEI`
 */
export function validateRegistrationFee(value: bigint): void {
  const expected = spRegistry.REGISTRATION_FEE
  if (value !== expected) {
    throw new ValidationError(
      `Incorrect registration fee: ${value}. Expected ${expected} (5 FIL). Omit \`value\` to fetch the live fee from the contract.`
    )
  }
}
