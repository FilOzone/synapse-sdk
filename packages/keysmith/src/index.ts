/**
 * Keysmith — deterministic per-keyspace key derivation for Filecoin Onchain Cloud.
 *
 * One wallet signature per keyspace produces every key beneath it. Nothing is
 * stored by this layer, nothing goes on chain but a 16-byte commitment, and a
 * wallet alone recovers everything.
 *
 * @example
 * ```ts
 * import * as Keysmith from '@filoz/keysmith'
 *
 * const ref = { owner: account.address, keyspace: Keysmith.newKeyspace() }
 * const { kk, commitment } = await Keysmith.keyspaceKeys(account, ref)
 *
 * const salt = Keysmith.newSalt()
 * const key = Keysmith.pieceKey(kk, salt)                        // hand to FEE
 * const metadata = Keysmith.pieceMetadata(ref, { salt })         // put in the envelope
 * const grant = await Keysmith.wrapTo(theirPublicKey, kk, Keysmith.grantDescriptor(ref, 'keyspace'))
 * ```
 *
 * @module
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
  newKeyspace,
  newSalt,
  pieceKey,
  pieceMetadata,
  roleKey,
  roleName,
  rolePath,
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
export { publicKeyOf, unwrapWith, wrapTo } from './wrap.ts'
