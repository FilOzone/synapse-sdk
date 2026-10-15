/**
 * Keysmith — deterministic wallet-based key derivation for Filecoin Onchain Cloud.
 */
export {
  COMMITMENT_KEY,
  commitment,
  DOMAIN,
  grantDescriptor,
  holdingOf,
  KEYSPACE_ID_KEY,
  KEYSPACE_KEY_TYPES,
  keyForEnvelope,
  keyspaceId,
  keyspaceKeyMessage,
  keyspaceKeys,
  lowSrs,
  matchesCommitment,
  newKeyspace,
  newSalt,
  pieceKey,
  pieceMetadata,
  pieceNode,
  scopeKey,
  scopeName,
  scopePath,
  writeTarget,
} from './derive.ts'
export type {
  Grant,
  GrantDescriptor,
  GrantNode,
  Holding,
  KeyspaceKeyMessage,
  KeyspaceKeys,
  KeyspaceKeysOptions,
  KeyspaceRef,
  PieceMetadata,
  TypedDataSigner,
  WriteTarget,
} from './types.ts'
export { decodeGrant, encodeGrant, publicKeyOf, unwrapWith, wrapTo } from './wrap.ts'
