/**
 * Localnet configuration utilities
 *
 * Loads localnet-specific configuration from environment variables.
 * This allows developers to run against local Filecoin networks without
 * hardcoding addresses.
 */

import type { Address } from 'viem'

/**
 * Environment variable names for localnet configuration
 */
export const LOCALNET_ENV_VARS = {
  CHAIN_ID: 'LOCALNET_CHAIN_ID',
  RPC_URL: 'LOCALNET_RPC_URL',
  RPC_WS_URL: 'LOCALNET_RPC_WS_URL',
  WARM_STORAGE: 'LOCALNET_WARM_STORAGE_ADDRESS',
  MULTICALL3: 'LOCALNET_MULTICALL3_ADDRESS',
  USDFC_TOKEN: 'LOCALNET_USDFC_ADDRESS',
  USDFC_NAME: 'LOCALNET_USDFC_NAME',
  USDFC_SYMBOL: 'LOCALNET_USDFC_SYMBOL',
  PAYMENTS: 'LOCALNET_PAYMENTS_ADDRESS',
  STORAGE_VIEW: 'LOCALNET_STORAGE_VIEW_ADDRESS',
  PDP_VERIFIER: 'LOCALNET_PDP_VERIFIER_ADDRESS',
  SP_REGISTRY: 'LOCALNET_SP_REGISTRY_ADDRESS',
  SESSION_KEY_REGISTRY: 'LOCALNET_SESSION_KEY_REGISTRY_ADDRESS',
  BLOCK_EXPLORER_URL: 'LOCALNET_BLOCK_EXPLORER_URL',
} as const

/**
 * Default values for localnet configuration
 */
const LOCALNET_DEFAULTS = {
  CHAIN_ID: 1414,
  RPC_URL: 'http://127.0.0.1:5700/rpc/v1',
  RPC_WS_URL: 'ws://127.0.0.1:5700/rpc/v1',
  MULTICALL3: '0xcA11bde05977b3631167028862bE2a173976CA11' as Address,
  USDFC_NAME: 'MockUSDFC',
  USDFC_SYMBOL: 'MockUSDFC',
  BLOCK_EXPLORER_URL: 'http://localhost:8080',
} as const

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
 * Get localnet chain ID from environment or use default
 */
export function getLocalnetChainId(): number {
  const envValue = getEnvVar(LOCALNET_ENV_VARS.CHAIN_ID)
  if (envValue != null) {
    const parsed = Number.parseInt(envValue, 10)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return LOCALNET_DEFAULTS.CHAIN_ID
}

/**
 * Get localnet RPC URL from environment or use default
 */
export function getLocalnetRpcUrl(): string {
  return getEnvVar(LOCALNET_ENV_VARS.RPC_URL) ?? LOCALNET_DEFAULTS.RPC_URL
}

/**
 * Get localnet WebSocket RPC URL from environment or use default
 */
export function getLocalnetWsUrl(): string {
  return getEnvVar(LOCALNET_ENV_VARS.RPC_WS_URL) ?? LOCALNET_DEFAULTS.RPC_WS_URL
}

/**
 * Get localnet contract address from environment
 * @throws Error if the address is not configured
 */
function getRequiredAddress(envVarName: string, contractName: string): Address {
  const address = getEnvVar(envVarName)
  if (address == null || address === '') {
    throw new Error(`${contractName} address not configured for localnet. Set ${envVarName} environment variable.`)
  }
  // Basic validation that it looks like an address
  if (!address.startsWith('0x') || address.length !== 42) {
    throw new Error(`Invalid ${contractName} address in ${envVarName}: ${address}`)
  }
  return address as Address
}

/**
 * Get localnet contract address from environment with optional default
 */
function getOptionalAddress(envVarName: string, defaultValue?: Address): Address | undefined {
  const address = getEnvVar(envVarName)
  if (address != null && address !== '') {
    if (!address.startsWith('0x') || address.length !== 42) {
      throw new Error(`Invalid address in ${envVarName}: ${address}`)
    }
    return address as Address
  }
  return defaultValue
}

/**
 * Get localnet Warm Storage contract address
 */
export function getLocalnetWarmStorageAddress(): Address {
  return getRequiredAddress(LOCALNET_ENV_VARS.WARM_STORAGE, 'Warm Storage')
}

/**
 * Get localnet Multicall3 contract address (optional, has default)
 */
export function getLocalnetMulticall3Address(): Address {
  return getOptionalAddress(LOCALNET_ENV_VARS.MULTICALL3, LOCALNET_DEFAULTS.MULTICALL3) ?? LOCALNET_DEFAULTS.MULTICALL3
}

/**
 * Get localnet USDFC token address
 */
export function getLocalnetUSDFCAddress(): Address {
  return getRequiredAddress(LOCALNET_ENV_VARS.USDFC_TOKEN, 'USDFC Token')
}

/**
 * Get localnet USDFC token name
 */
export function getLocalnetUSDFCName(): string {
  return getEnvVar(LOCALNET_ENV_VARS.USDFC_NAME) ?? LOCALNET_DEFAULTS.USDFC_NAME
}

/**
 * Get localnet USDFC token symbol
 */
export function getLocalnetUSDFCSymbol(): string {
  return getEnvVar(LOCALNET_ENV_VARS.USDFC_SYMBOL) ?? LOCALNET_DEFAULTS.USDFC_SYMBOL
}

/**
 * Get localnet Payments contract address (optional - can be auto-discovered)
 */
export function getLocalnetPaymentsAddress(): Address | undefined {
  return getOptionalAddress(LOCALNET_ENV_VARS.PAYMENTS)
}

/**
 * Get localnet Storage View contract address (optional - can be auto-discovered)
 */
export function getLocalnetStorageViewAddress(): Address | undefined {
  return getOptionalAddress(LOCALNET_ENV_VARS.STORAGE_VIEW)
}

/**
 * Get localnet PDP Verifier contract address (optional - can be auto-discovered)
 */
export function getLocalnetPDPVerifierAddress(): Address | undefined {
  return getOptionalAddress(LOCALNET_ENV_VARS.PDP_VERIFIER)
}

/**
 * Get localnet Service Provider Registry contract address (optional - can be auto-discovered)
 */
export function getLocalnetSPRegistryAddress(): Address | undefined {
  return getOptionalAddress(LOCALNET_ENV_VARS.SP_REGISTRY)
}

/**
 * Get localnet Session Key Registry contract address (optional - can be auto-discovered)
 */
export function getLocalnetSessionKeyRegistryAddress(): Address | undefined {
  return getOptionalAddress(LOCALNET_ENV_VARS.SESSION_KEY_REGISTRY)
}

/**
 * Get localnet block explorer URL
 */
export function getLocalnetBlockExplorerUrl(): string {
  return getEnvVar(LOCALNET_ENV_VARS.BLOCK_EXPLORER_URL) ?? LOCALNET_DEFAULTS.BLOCK_EXPLORER_URL
}

/**
 * Check if all required localnet environment variables are set
 * @returns Object with missing variable names and validation result
 */
export function validateLocalnetConfig(): { isValid: boolean; missing: string[] } {
  const required = [LOCALNET_ENV_VARS.WARM_STORAGE, LOCALNET_ENV_VARS.USDFC_TOKEN]

  const missing = required.filter((envVar) => {
    const value = getEnvVar(envVar)
    return value == null || value === ''
  })

  return {
    isValid: missing.length === 0,
    missing,
  }
}

/**
 * Get a helpful message about required localnet environment variables
 */
export function getLocalnetConfigHelp(): string {
  return `
Localnet Configuration Required:

Required environment variables:
  ${LOCALNET_ENV_VARS.WARM_STORAGE} - Warm Storage contract address
  ${LOCALNET_ENV_VARS.USDFC_TOKEN} - USDFC token contract address

Optional environment variables (with defaults):
  ${LOCALNET_ENV_VARS.CHAIN_ID} (default: ${LOCALNET_DEFAULTS.CHAIN_ID})
  ${LOCALNET_ENV_VARS.RPC_URL} (default: ${LOCALNET_DEFAULTS.RPC_URL})
  ${LOCALNET_ENV_VARS.RPC_WS_URL} (default: ${LOCALNET_DEFAULTS.RPC_WS_URL})
  ${LOCALNET_ENV_VARS.MULTICALL3} (default: ${LOCALNET_DEFAULTS.MULTICALL3})
  ${LOCALNET_ENV_VARS.USDFC_NAME} (default: ${LOCALNET_DEFAULTS.USDFC_NAME})
  ${LOCALNET_ENV_VARS.USDFC_SYMBOL} (default: ${LOCALNET_DEFAULTS.USDFC_SYMBOL})
  ${LOCALNET_ENV_VARS.BLOCK_EXPLORER_URL} (default: ${LOCALNET_DEFAULTS.BLOCK_EXPLORER_URL})

Auto-discovered from Warm Storage contract (optional to override):
  ${LOCALNET_ENV_VARS.PAYMENTS}
  ${LOCALNET_ENV_VARS.STORAGE_VIEW}
  ${LOCALNET_ENV_VARS.PDP_VERIFIER}
  ${LOCALNET_ENV_VARS.SP_REGISTRY}
  ${LOCALNET_ENV_VARS.SESSION_KEY_REGISTRY}

Example .env file:
  LOCALNET_WARM_STORAGE_ADDRESS=0x1234567890123456789012345678901234567890
  LOCALNET_USDFC_ADDRESS=0x0987654321098765432109876543210987654321
  LOCALNET_RPC_URL=http://localhost:1234/rpc/v1
`.trim()
}
