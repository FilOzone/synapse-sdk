/**
 * Keysmith — deterministic per-dataset key derivation for Filecoin Onchain Cloud.
 *
 * One wallet signature per dataset produces every key beneath it. Nothing is
 * stored by this layer, nothing goes on chain but a 16-byte commitment, and a
 * wallet alone recovers everything.
 *
 * @module
 */
export {
  COMMITMENT_KEY,
  commitment,
  DATASET_KEY_TYPES,
  DOMAIN,
  datasetKey,
  datasetKeyMessage,
  datasetSecret,
  grantDescriptor,
  holdingOf,
  keyForEnvelope,
  lowSrs,
  newClientDataSetId,
  newSalt,
  pieceKey,
  pieceMetadata,
  scopeKey,
} from './derive.ts'
export type {
  DatasetKeyMessage,
  DatasetRef,
  Grant,
  GrantDescriptor,
  GrantNode,
  Holding,
  PieceMetadata,
  TypedDataSigner,
} from './types.ts'
export { publicKeyOf, unwrapWith, wrapTo } from './wrap.ts'
