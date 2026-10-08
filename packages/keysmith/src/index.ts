/**
 * Keysmith — deterministic per-keyspace key derivation for Filecoin Onchain Cloud.
 *
 * One wallet signature per keyspace (and epoch) produces every key beneath it.
 * Nothing is stored by this layer. All that goes on chain is the keyspace id
 * and a commitment to its key, in data-set metadata; no key does. A wallet
 * alone recovers everything.
 *
 * @example
 * ```ts
 * import * as Keysmith from '@filoz/keysmith'
 *
 * const ref = { owner: account.address, keyspace: Keysmith.newKeyspace() }
 * const { kk, commitment, descriptor } = await Keysmith.keyspaceKeys(account, ref)
 *
 * const target = Keysmith.writeTarget(descriptor, kk, 'agent-memory')
 * const salt = Keysmith.newSalt()
 * const key = Keysmith.pieceKey(target.key, salt)                               // hand to FEE
 * const metadata = Keysmith.pieceMetadata(target.ref, { salt, role: target.role }) // put in the envelope
 * const grant = await Keysmith.wrapTo(theirPublicKey, kk, descriptor)
 * ```
 *
 * @module
 */
export {
  COMMITMENT_KEY,
  commitment,
  commitmentEpoch,
  DOMAIN,
  epochOf,
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
