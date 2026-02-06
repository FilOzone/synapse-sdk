import type { Address } from 'viem'
import type { PieceCID } from '../piece.ts'
import type { PDPProvider } from '../sp-registry/types.ts'
import type { MetadataObject } from '../utils/metadata.ts'

export type * from '../utils/metadata.ts'

/**
 * Data set information returned from Warm Storage contract
 */
export type DataSetInfo = {
  /** Payment rail ID for PDP proofs. */
  pdpRailId: bigint
  /** Payment rail ID for cache-miss egress. */
  cacheMissRailId: bigint
  /** Payment rail ID for CDN egress. */
  cdnRailId: bigint
  /** Payer address for data set storage. */
  payer: Address
  /** Payee address for data set storage. */
  payee: Address
  /** Service provider address. */
  serviceProvider: Address
  /** Commission in basis points. */
  commissionBps: bigint
  /** Client-provided data set ID (nonce). */
  clientDataSetId: bigint
  /** End epoch for PDP service. */
  pdpEndEpoch: bigint
  /** Provider ID for the data set. */
  providerId: bigint
  /** Data set ID. */
  dataSetId: bigint
}

export type PdpDataSetInfo = {
  /** Whether the data set is live in the PDP Verifier contract. */
  live: boolean
  /** Whether the data set is managed by the current Warm Storage contract. */
  managed: boolean
  /** Whether the data set is using CDN. */
  cdn: boolean
  /** Metadata associated with the data set. */
  metadata: MetadataObject
  /** PDP provider associated with the data set. */
  provider: PDPProvider
}

export interface PdpDataSet extends DataSetInfo, PdpDataSetInfo {}

export interface Piece {
  cid: PieceCID
  id: bigint
  url: string
}

export interface PieceWithMetadata extends Piece {
  metadata: MetadataObject
}
