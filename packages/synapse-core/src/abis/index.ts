/**
 * Synapse Core - ABIs
 *
 * @example
 * ```ts
 * import * as Abis from '@filoz/synapse-core/abis'
 * ```
 *
 * @packageDocumentation
 */

export * from './erc20.ts'
export * as generated from './generated.ts'

export {
  filecoinPayV1Abi as payments,
  filecoinWarmStorageServiceAbi as storage,
  filecoinWarmStorageServiceStateViewAbi as storageView,
  pdpVerifierAbi as pdp,
  serviceProviderRegistryAbi as serviceProviderRegistry,
  sessionKeyRegistryAbi as sessionKeyRegistry,
} from './generated.ts'
