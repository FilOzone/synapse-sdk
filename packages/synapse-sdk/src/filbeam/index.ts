/**
 * FilBeam Service
 *
 * Client for the FilBeam stats API.
 *
 * ## Overview
 *
 * FilBeam enables retrieval incentives for Filecoin PDP (Proof of Data Possession)
 * service providers by acting as a trusted intermediary that measures traffic
 * between clients and storage providers.
 *
 * ## Architecture
 *
 * FilBeam operates as a caching layer between clients and storage providers,
 * enabling efficient retrieval of content-addressable data stored on Filecoin PDP.
 *
 * ```
 * Client  <-->  FilBeam (cache + metering)  <-->  Storage Provider
 * ```
 *
 * ## Billing Model
 *
 * Both cache hits and cache misses generate billable egress events. This transforms
 * Filecoin from passive archival storage into an active "serve many" data delivery
 * infrastructure, where service providers are compensated for serving retrievals.
 *
 * @module FilBeam
 *
 * @example Basic Usage
 * ```typescript
 * import { FilBeamService } from '@filoz/synapse-sdk/filbeam'
 *
 * // Create service for mainnet
 * const service = new FilBeamService('mainnet')
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
 * @see {@link https://docs.filbeam.com | FilBeam Documentation} - Official FilBeam documentation
 * @see {@link https://meridian.space/blog/introducing-pay-per-byte-a-new-era-for-filecoin-retrieval | Pay Per Byte Blog Post} - Introduction to the pay-per-byte pricing model
 * @see {@link DataSetStats} for the structure of returned statistics
 * @see {@link FilBeamService} for the main service class
 */

export { type DataSetStats, FilBeamService } from './service.ts'
