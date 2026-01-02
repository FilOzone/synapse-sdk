/**
 * Localnet configuration for synapse-core
 *
 * Loads localnet-specific configuration from environment variables.
 */

import type { Address } from 'viem'

/**
 * Get environment variable value with Node.js and browser compatibility
 */
function getEnvVar(key: string): string | undefined {
  // Node.js environment
  if (typeof process !== 'undefined' && process.env != null) {
    return process.env[key]
  }
  // Browser environment (if using build tools like Vite)
  // @ts-expect-error - import.meta.env is provided by build tools like Vite
  if (typeof import.meta !== 'undefined' && import.meta.env != null) {
    // @ts-expect-error - import.meta.env is provided by build tools like Vite
    return (import.meta.env as Record<string, string>)[key]
  }
  return undefined
}

/**
 * Localnet chain ID (default: 1414)
 */
export function getLocalnetChainId(): number {
  const envValue = getEnvVar('LOCALNET_CHAIN_ID')
  if (envValue != null) {
    const parsed = Number.parseInt(envValue, 10)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return 1414
}

/**
 * Localnet RPC URL (default: http://127.0.0.1:5700/rpc/v1)
 */
export function getLocalnetRpcUrl(): string {
  return getEnvVar('LOCALNET_RPC_URL') ?? 'http://127.0.0.1:5700/rpc/v1'
}

/**
 * Localnet WebSocket URL (default: ws://127.0.0.1:5700/rpc/v1)
 */
export function getLocalnetWsUrl(): string {
  return getEnvVar('LOCALNET_RPC_WS_URL') ?? 'ws://127.0.0.1:5700/rpc/v1'
}

/**
 * Localnet block explorer URL (default: http://localhost:8080)
 */
export function getLocalnetBlockExplorerUrl(): string {
  return getEnvVar('LOCALNET_BLOCK_EXPLORER_URL') ?? 'http://localhost:8080'
}

/**
 * Get localnet contract address from environment
 */
function getRequiredAddress(envVarName: string, contractName: string): Address {
  const address = getEnvVar(envVarName)
  if (address == null || address === '') {
    throw new Error(`${contractName} address not configured for localnet. Set ${envVarName} environment variable.`)
  }
  if (!address.startsWith('0x') || address.length !== 42) {
    throw new Error(`Invalid ${contractName} address in ${envVarName}: ${address}`)
  }
  return address as Address
}

/**
 * Get optional address with default
 */
function getOptionalAddress(envVarName: string, defaultValue: Address): Address {
  const address = getEnvVar(envVarName)
  if (address != null && address !== '') {
    if (!address.startsWith('0x') || address.length !== 42) {
      throw new Error(`Invalid address in ${envVarName}: ${address}`)
    }
    return address as Address
  }
  return defaultValue
}

export function getLocalnetMulticall3Address(): Address {
  return getOptionalAddress('LOCALNET_MULTICALL3_ADDRESS', '0xcA11bde05977b3631167028862bE2a173976CA11')
}

export function getLocalnetUSDFCAddress(): Address {
  return getRequiredAddress('LOCALNET_USDFC_ADDRESS', 'USDFC Token')
}

export function getLocalnetUSDFCName(): string {
  return getEnvVar('LOCALNET_USDFC_NAME') ?? 'Local USDFC'
}

export function getLocalnetUSDFCSymbol(): string {
  return getEnvVar('LOCALNET_USDFC_SYMBOL') ?? 'lUSDFC'
}

export function getLocalnetPaymentsAddress(): Address {
  return getRequiredAddress('LOCALNET_PAYMENTS_ADDRESS', 'Payments')
}

export function getLocalnetStorageAddress(): Address {
  return getRequiredAddress('LOCALNET_WARM_STORAGE_ADDRESS', 'Warm Storage')
}

export function getLocalnetStorageViewAddress(): Address {
  return getRequiredAddress('LOCALNET_STORAGE_VIEW_ADDRESS', 'Storage View')
}

export function getLocalnetSPRegistryAddress(): Address {
  return getRequiredAddress('LOCALNET_SP_REGISTRY_ADDRESS', 'Service Provider Registry')
}

export function getLocalnetSessionKeyRegistryAddress(): Address {
  return getRequiredAddress('LOCALNET_SESSION_KEY_REGISTRY_ADDRESS', 'Session Key Registry')
}

export function getLocalnetPDPAddress(): Address {
  return getRequiredAddress('LOCALNET_PDP_VERIFIER_ADDRESS', 'PDP Verifier')
}
