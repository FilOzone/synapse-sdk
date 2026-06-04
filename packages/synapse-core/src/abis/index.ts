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
import { priceListAbi } from './price-list.ts'

// Merge the storage and errors ABIs
export const fwss = [...generated.filecoinWarmStorageServiceAbi, ...generated.errorsAbi] as const
export const serviceProviderRegistry = [...generated.serviceProviderRegistryAbi, ...generated.errorsAbi] as const
// The view ABI plus the standalone getPriceList fragment. See abis/price-list.ts.
// TODO: drop the priceListAbi merge and re-export filecoinWarmStorageServiceStateViewAbi
// as fwssView once the generated ABI ref includes getPriceList.
export const fwssView = [...generated.filecoinWarmStorageServiceStateViewAbi, ...priceListAbi] as const

export {
  filecoinPayV1Abi as filecoinPay,
  pdpVerifierAbi as pdp,
  providerIdSetAbi as providerIdSet,
  sessionKeyRegistryAbi as sessionKeyRegistry,
} from './generated.ts'
