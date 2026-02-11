/**
 * Storage components
 *
 * @module Storage
 * @example
 * ```ts
 * import { StorageContext, StorageManager } from '@filoz/synapse-sdk/storage'
 * ```
 */

export type { StorageContextOptions } from './context.ts'
export { StorageContext } from './context.ts'
export type {
  CombinedCallbacks,
  StorageManagerDownloadOptions,
  StorageManagerOptions,
  StorageManagerUploadOptions,
} from './manager.ts'
export { StorageManager } from './manager.ts'
