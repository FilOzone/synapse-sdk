import type { Address, Hex } from 'viem'
import { pad } from 'viem'

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
 * Matches the behavior of `address(uint160(BigEndian.decode(values[i])))`
 */
export function decodeAddressCapability(capabilityValue: Hex): Address {
  if (capabilityValue.length > 66) {
    return '0x0000000000000000000000000000000000000000'
  }
  if (capabilityValue.length > 42) {
    return `0x${capabilityValue.slice(-40)}`
  }
  if (capabilityValue.length < 42) {
    return pad(capabilityValue, { size: 20 })
  }
  return capabilityValue
}
