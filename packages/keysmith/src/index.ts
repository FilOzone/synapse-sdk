/**
 * Keysmith — deterministic per-dataset key derivation for Filecoin Onchain Cloud.
 *
 * One wallet signature per dataset produces every key beneath it. Nothing is
 * stored by this layer, nothing goes on chain but a 16-byte commitment, and a
 * wallet alone recovers everything.
 *
 * @example
 * ```ts
 * import * as Keysmith from '@filoz/keysmith'
 *
 * const ref = { chainId: 314, service: fwss, payer: account.address, clientDataSetId }
 * const { dk, commitment } = await Keysmith.datasetKeys(account, ref)
 *
 * const salt = Keysmith.newSalt()
 * const key = Keysmith.pieceKey(dk, salt)                        // hand to FEE
 * const metadata = Keysmith.pieceMetadata(ref, { salt })         // put in the envelope
 * const grant = await Keysmith.wrapTo(theirPublicKey, dk, Keysmith.grantDescriptor(ref, 'dataset'))
 * ```
 *
 * @module
 */
export {
  COMMITMENT_KEY,
  DATASET_KEY_TYPES,
  DOMAIN,
  datasetKeyMessage,
  datasetKeys,
  grantDescriptor,
  holdingOf,
  keyForEnvelope,
  lowSrs,
  newClientDataSetId,
  newSalt,
  pieceKey,
  pieceMetadata,
  scopeKey,
  scopeName,
} from './derive.ts'
export type {
  DatasetKeyMessage,
  DatasetKeys,
  DatasetKeysOptions,
  DatasetRef,
  Grant,
  GrantDescriptor,
  GrantNode,
  Holding,
  PieceMetadata,
  TypedDataSigner,
} from './types.ts'
export { publicKeyOf, unwrapWith, wrapTo } from './wrap.ts'
