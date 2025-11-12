/**
 * FilBeam Service
 *
 * This module provides access to FilBeam's services and trusted measurement layer. 
 * FilBeam solves the fundamental challenge that proving data retrieval 
 * is cryptographically impossible without enabling fraud, by acting
 * as a trusted intermediary that measures actual egress volumes through real client traffic.
 *
 * ## Key Features
 *
 * - **Trusted Measurement**: Accurately tracks data egress from storage providers
 * - **Dual-Tier Architecture**: Differentiates between CDN cache hits and cache misses
 * - **Economic Incentives**: Enables storage providers to earn 7 USDFC per TiB served
 * - **Pay-As-You-Go**: Clients pay only for what they use (~0.014 USDFC per GiB)
 * - **No Subscriptions**: Wallet-centric model without monthly fees
 *
 * ## Architecture
 *
 * FilBeam operates as a caching layer between clients and storage providers:
 *
 * 1. **Cache Hits**: Data served directly from FilBeam's CDN (fast, efficient)
 * 2. **Cache Misses**: Data retrieved from storage providers and cached for future use
 *
 * Both scenarios generate billable egress events, transforming Filecoin from passive
 * archival storage to an active "serve many" data delivery infrastructure.
 *
 * @module FilBeam
 *
 * @example Basic Usage
 * ```typescript
 * import { FilBeamService } from '@filoz/synapse-sdk/filbeam'
 *
 * // Create service for mainnet
 * const service = FilBeamService.create('mainnet')
 *
 * // Get remaining data set statistics
 * const stats = await service.getDataSetStats('dataset-id')
 * console.log('Remaining CDN Egress:', stats.cdnEgressQuota)
 * console.log('Remaining Cache Miss:', stats.cacheMissEgressQuota)
 * ```
 *
 * @example Integration with Synapse SDK
 * ```typescript
 * import { Synapse } from '@filoz/synapse-sdk'
 *
 * // Initialize Synapse
 * const synapse = await Synapse.create({
 *   privateKey: process.env.PRIVATE_KEY,
 *   rpcURL: 'https://api.node.glif.io/rpc/v1'
 * })
 *
 * // Access FilBeam service through Synapse
 * const stats = await synapse.filbeam.getDataSetStats('my-dataset')
 *
 * // Monitor remaining quotas over time
 * setInterval(async () => {
 *   const currentStats = await synapse.filbeam.getDataSetStats('my-dataset')
 *   console.log('Remaining quotas:', currentStats)
 *
 *   // Alert if running low
 *   const TiB = BigInt(1024 ** 4)
 *   const remainingTiB = Number((currentStats.cdnEgressQuota + currentStats.cacheMissEgressQuota) / TiB)
 *   if (remainingTiB < 1) {
 *     console.warn('Low quota warning: Less than 1 TiB remaining')
 *   }
 * }, 60000) // Check every minute
 * ```
 *
 * @example Testing with Mock Fetch
 * ```typescript
 * import { FilBeamService } from '@filoz/synapse-sdk/filbeam'
 *
 * // Create service with mock fetch for testing
 * const mockFetch = async (url: string) => {
 *   return {
 *     status: 200,
 *     json: async () => ({
 *       cdnEgressQuota: '1099511627776', // 1 TiB in bytes
 *       cacheMissEgressQuota: '549755813888' // 0.5 TiB in bytes
 *     })
 *   } as Response
 * }
 *
 * const service = new FilBeamService('mainnet', mockFetch)
 * const stats = await service.getDataSetStats('test')
 * ```
 *
 * @see {@link https://docs.filbeam.com | FilBeam Documentation} - Official FilBeam documentation
 * @see {@link https://meridian.space/blog/introducing-pay-per-byte-a-new-era-for-filecoin-retrieval | Pay Per Byte Blog Post} - Introduction to the pay-per-byte pricing model
 * @see {@link DataSetStats} for the structure of returned statistics
 * @see {@link FilBeamService} for the main service class
 */

export { type DataSetStats, FilBeamService } from './service.ts'
