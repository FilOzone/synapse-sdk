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
 * const secret = await Keysmith.datasetSecret(account, ref)
 * const dk = Keysmith.datasetKey(secret)
 *
 * const salt = Keysmith.newSalt()
 * const key = Keysmith.pieceKey(dk, salt)                        // hand to FEE
 * const metadata = Keysmith.pieceMetadata(ref, { salt })         // put in the envelope
 * const grant = await Keysmith.wrapTo(theirPublicKey, dk, descriptor)  // share it
 * ```
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
  Holding,
  PieceMetadata,
  TypedDataSigner,
} from './types.ts'
export { publicKeyOf, unwrapWith, wrapTo } from './wrap.ts'
