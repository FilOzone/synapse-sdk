import { TAG_ENCRYPT0 } from '../cose/constants.ts'
import type { DecodedEnvelope } from '../cose/decode.ts'
import { NoUsableRecipientError, RecipientUnwrapError } from '../errors.ts'
import { assertAes256Key } from '../internal/keys.ts'
import { toRecipientInfo } from './info.ts'
import type { Unwrapper } from './types.ts'

/**
 * Recover and validate a CEK from a decoded envelope's recipients.
 *
 * For tag 96, calls `unwrapper` once with isolated copies of every recipient
 * in wire order. A tag-16 envelope or an unmatched recipient list fails with
 * `NoUsableRecipientError`; an unwrapper failure becomes
 * `RecipientUnwrapError`. The returned key must be a nonzero 32-byte CEK.
 */
export async function recoverCek(decoded: DecodedEnvelope, unwrapper: Unwrapper): Promise<Uint8Array<ArrayBuffer>> {
  if (decoded.tag === TAG_ENCRYPT0) {
    throw new NoUsableRecipientError(
      'No usable recipient: this envelope is COSE_Encrypt0 and carries no recipients; supply the CEK directly instead.'
    )
  }

  const infos = decoded.recipients.map(toRecipientInfo)
  let cek: Uint8Array | undefined
  try {
    cek = await unwrapper(infos)
  } catch (cause) {
    throw new RecipientUnwrapError('Recipient key recovery failed.', { cause })
  }
  if (cek === undefined) {
    throw new NoUsableRecipientError(
      `No usable recipient: none of the ${infos.length} recipients offered a usable key.`
    )
  }
  assertAes256Key(cek, 'recovered CEK')
  return cek
}
