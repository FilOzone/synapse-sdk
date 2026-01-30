/**
 * **Synapse SDK - Main entry point**
 *
 * @module Synapse
 *
 * @example
 * ```ts twoslash
 * import { Synapse } from '@filoz/synapse-sdk'
 * ```
 */

export * from '@filoz/synapse-core/chains'
export { formatUnits, parseUnits } from '@filoz/synapse-core/utils'
export { Synapse } from './synapse.ts'
export * from './types.ts'
export * from './utils/constants.ts'
