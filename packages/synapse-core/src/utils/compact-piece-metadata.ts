import type { MetadataEntry } from '../typed-data/type-definitions.ts'

/**
 * Use the compact contract representation when no piece in a batch has metadata.
 * Mixed and metadata-bearing batches must retain one entry per piece.
 *
 * @see https://github.com/FilOzone/filecoin-services/blob/262646f637d556dc978a8b0bae2e77ef5b2d261d/service_contracts/src/FilecoinWarmStorageService.sol#L804-L819
 */
export function compactPieceMetadata(pieceMetadata: MetadataEntry[][]): MetadataEntry[][] {
  return pieceMetadata.some((metadata) => metadata.length > 0) ? pieceMetadata : []
}
