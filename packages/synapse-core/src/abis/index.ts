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
export const fwss = [...generated.filecoinWarmStorageServiceAbi, ...generated.errorsAbi] as const
export const serviceProviderRegistry = [...generated.serviceProviderRegistryAbi, ...generated.errorsAbi] as const

export {
  filecoinPayV1Abi as filecoinPay,
  filecoinWarmStorageServiceStateViewAbi as fwssView,
  pdpVerifierAbi as pdp,
  providerIdSetAbi as providerIdSet,
  sessionKeyRegistryAbi as sessionKeyRegistry,
} from './generated.ts'
