/**
 * ABIs
 *
 * @example
 * ```ts
 * import * as Abis from '@filoz/synapse-core/abis'
 * ```
 *
 * @module abis
 */

export * from './erc20.ts'
export * as generated from './generated.ts'

import * as generated from './generated.ts'

// Merge the storage and errors ABIs
export const storage = [...generated.filecoinWarmStorageServiceAbi, ...generated.errorsAbi] as const

export {
  filecoinPayV1Abi as payments,
  filecoinWarmStorageServiceStateViewAbi as storageView,
  pdpVerifierAbi as pdp,
  providerIdSetAbi as providerIdSet,
  serviceProviderRegistryAbi as serviceProviderRegistry,
  sessionKeyRegistryAbi as sessionKeyRegistry,
} from './generated.ts'
