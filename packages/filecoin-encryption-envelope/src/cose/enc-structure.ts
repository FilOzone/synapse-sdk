/**
 * `Enc_structure` (RFC 9052 §5.3): the AAD authenticated by every AEAD
 * operation in this envelope, whole-object and per-chunk alike — see
 * docs/tech-spec.md, "AAD".
 *
 * The context string depends on the envelope's CBOR tag, not on whether it
 * carries recipients.
 */
import { encode, rfc8949EncodeOptions } from 'cborg'
import { MalformedEnvelopeError } from '../errors.ts'
import { TAG_ENCRYPT, TAG_ENCRYPT0 } from './constants.ts'

/** Which of the two COSE containers this is — and so which context string the AAD carries. */
export type EnvelopeTag = typeof TAG_ENCRYPT0 | typeof TAG_ENCRYPT

const CONTEXT_ENCRYPT0 = 'Encrypt0'
const CONTEXT_ENCRYPT = 'Encrypt'

function contextForTag(tag: EnvelopeTag) {
  if (tag === TAG_ENCRYPT0) {
    return CONTEXT_ENCRYPT0
  }
  if (tag === TAG_ENCRYPT) {
    return CONTEXT_ENCRYPT
  }
  // Unreachable from TypeScript because `EnvelopeTag` covers both cases.
  // Keep this check for JavaScript callers to prevent an unknown tag from
  // producing `undefined` in the AAD.
  throw new MalformedEnvelopeError(`Invalid envelope tag: ${String(tag)}. Expected ${TAG_ENCRYPT0} or ${TAG_ENCRYPT}.`)
}

/**
 * Build the `Enc_structure` bytes for an envelope:
 * `[context, protected, external_aad]`, with `external_aad` always empty.
 *
 * `protectedHeaderBytes` must be the exact bytes from the wire when decoding,
 * or the bytes returned by `encodeProtectedHeader()` when encoding. Do not
 * re-encode a decoded header map, as the resulting bytes may differ and break
 * authentication.
 */
export function encStructure(tag: EnvelopeTag, protectedHeaderBytes: Uint8Array): Uint8Array {
  const context = contextForTag(tag)
  // The CDDL requires the second element to be a bstr. Other types encode to
  // different CBOR major types and produce AAD that other implementations
  // cannot reproduce, resulting in an otherwise hard-to-debug tag mismatch.
  if (!(protectedHeaderBytes instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(
      `Invalid protected header bytes: expected a Uint8Array, got ${typeof protectedHeaderBytes}.`
    )
  }
  return encode([context, protectedHeaderBytes, new Uint8Array(0)], rfc8949EncodeOptions)
}
