/** Shared CEK-recovery steps for `aesGcm.decryptWith` and the chunked stream's `decryptWith`. */
import { TAG_ENCRYPT0 } from '../cose/constants.ts'
import type { DecodedEnvelope } from '../cose/decode.ts'
import { NoUsableRecipientError, RecipientUnwrapError } from '../errors.ts'
import { assertAes256Key } from '../internal/keys.ts'
import { toRecipientInfo } from './info.ts'
import type { Unwrapper } from './types.ts'

/**
 * Recover a CEK from a decoded envelope's recipients via `unwrapper`.
 *
 * Accepts only `COSE_Encrypt` (tag 96); a tag-16 envelope carries no
 * recipients and fails with `NoUsableRecipientError` without calling
 * `unwrapper`. Each recipient is copied into an isolated `RecipientInfo`
 * before reaching `unwrapper`. `unwrapper` is called at most once, with every
 * recipient in wire order; its resolved CEK is validated as an exactly
 * 32-byte, non-zero key before use.
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
