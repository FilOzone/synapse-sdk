/**
 * Envelope encode: assembles the protected header, unprotected header, and
 * optional recipients into the wire-format COSE structure (docs/tech-spec.md,
 * "Wire profile" and "CDDL"). This module only shapes bytes — no AEAD, no
 * key wrap, no chunk framing; those live in layers above this one.
 *
 * Two paths: `prepareEnvelope`/`encodeEnvelope` validate arbitrary structured
 * input and are the checked conformance encoder, used by wire-format tests to
 * build fixtures and check encode/decode symmetry. `assemblePreparedEnvelope`
 * skips that validation and assembles records the library already built and
 * trusts; the AEAD layer uses it.
 */
import { encode as cborEncode, rfc8949EncodeOptions, Tagged } from 'cborg'
import { MalformedEnvelopeError } from '../errors.ts'
import { MAX_ENVELOPE_SIZE, TAG_ENCRYPT, TAG_ENCRYPT0 } from './constants.ts'
import type { EnvelopeTag } from './enc-structure.ts'
import type { CborValue, ProtectedHeaderFields } from './headers.ts'
import {
  assertAllowlistedValue,
  assertRecipientCiphertext,
  decodeRecipientHeaders,
  describeCborType,
  encodeProtectedHeader,
  encodeUnprotectedHeader,
} from './headers.ts'

/** Input for one `COSE_recipient`. This layer shapes it; it never wraps a key. */
export interface RecipientInput {
  /**
   * This recipient's serialized protected header, or `h''` for none. Which
   * of the two is required depends on the recipient algorithm: A256KW needs
   * the empty form, ECDH-ES+A256KW a map carrying `alg`.
   */
  protectedBytes: Uint8Array
  /** Text labels are legal (RFC 9052 §3.1) but only ever come from an application extension. */
  unprotected: Map<number | string, CborValue>
  /** Wrapped key material. */
  ciphertext: Uint8Array
}

/**
 * The recipient's unprotected map is nested four levels below the top-level
 * envelope: envelope tag → envelope array → recipients array → recipient tuple.
 *
 * The depth check counts the map itself, so start at 4 to include these
 * enclosing levels and keep the encoder within the decoder's depth limit.
 */
const RECIPIENT_ENCLOSING_DEPTH = 4

export interface EncodeEnvelopeInput {
  protectedHeader: ProtectedHeaderFields
  /**
   * A non-empty array selects tag 96 (`COSE_Encrypt`); omitting `recipients`
   * selects tag 16 (`COSE_Encrypt0`). An empty array is invalid rather than
   * being treated as `COSE_Encrypt0`, since it indicates a different caller intent.
   */
  recipients?: readonly RecipientInput[]
}

/**
 * Result of assembling an envelope: its encoded bytes, the exact protected
 * bytes placed inside it (needed verbatim for `Enc_structure`), and its tag.
 */
export interface PreparedEnvelope {
  bytes: Uint8Array
  protectedBytes: Uint8Array
  tag: EnvelopeTag
}

/**
 * Validate arbitrary structured input and encode an envelope, retaining the
 * protected bytes alongside the encoded bytes.
 */
export function prepareEnvelope(input: EncodeEnvelopeInput): PreparedEnvelope {
  if (input === null || typeof input !== 'object') {
    throw new MalformedEnvelopeError(`Invalid envelope input: expected an object, got ${describeCborType(input)}.`)
  }

  // Read the fields once: a getter could otherwise answer differently for
  // validation than for encoding.
  const { protectedHeader, recipients: recipientInputs } = input
  const recipients = prepareRecipientRecords(recipientInputs)
  return assemble(encodeProtectedHeader(protectedHeader), recipients)
}

/**
 * Map already-built recipient records straight into COSE tuples, skipping
 * `prepareRecipientRecords`'s validation. `records` omitted selects tag 16
 * (`COSE_Encrypt0`); a non-empty list selects tag 96 (`COSE_Encrypt`).
 */
export function assemblePreparedEnvelope(
  envelopeProtectedBytes: Uint8Array,
  records: readonly RecipientInput[] = []
): PreparedEnvelope {
  const recipients: CborValue[][] = records.map(
    ({ protectedBytes: recipientProtectedBytes, unprotected, ciphertext }) => [
      recipientProtectedBytes,
      unprotected,
      ciphertext,
    ]
  )

  return assemble(envelopeProtectedBytes, recipients)
}

/**
 * Validate caller-supplied recipient records and convert them to
 * `[protected, unprotected, ciphertext]` tuples. Omitted input yields `[]`
 * (tag 16); an empty array is rejected. Each record must pass the same
 * header rules `decodeEnvelope` applies, and its unprotected map must be
 * encodable within the decoder's depth limit.
 */
function prepareRecipientRecords(recipientInputs: readonly RecipientInput[] | undefined): CborValue[][] {
  if (recipientInputs !== undefined) {
    if (!Array.isArray(recipientInputs)) {
      throw new MalformedEnvelopeError(
        `Invalid recipients: expected an array, got ${describeCborType(recipientInputs)}.`
      )
    }
    if (recipientInputs.length === 0) {
      throw new MalformedEnvelopeError(
        'Invalid recipients: an empty array is not a request for COSE_Encrypt0. Omit the field entirely to encode ' +
          `tag ${TAG_ENCRYPT0}, or supply at least one recipient to encode tag ${TAG_ENCRYPT}.`
      )
    }
  }

  // Use an indexed loop to validate every position in the array. `.map` ignores
  // missing entries in sparse arrays, which could otherwise bypass validation.
  const inputs = recipientInputs ?? []
  const recipients: CborValue[][] = []
  for (let index = 0; index < inputs.length; index++) {
    const recipient = inputs[index]

    if (recipient === null || typeof recipient !== 'object') {
      throw new MalformedEnvelopeError(
        `Invalid recipients[${index}]: expected an object, got ${describeCborType(recipient)}.`
      )
    }

    const { protectedBytes, unprotected, ciphertext } = recipient
    const { alg } = decodeRecipientHeaders(protectedBytes, unprotected, `recipients[${index}]`)

    if (!(ciphertext instanceof Uint8Array)) {
      throw new MalformedEnvelopeError(
        `Invalid recipients[${index}].ciphertext: expected a byte string of wrapped key material, got ` +
          `${describeCborType(ciphertext)}.`
      )
    }
    assertRecipientCiphertext(alg, ciphertext, `recipients[${index}]`)

    assertAllowlistedValue(unprotected, `recipients[${index}].unprotected`, RECIPIENT_ENCLOSING_DEPTH)
    recipients.push([protectedBytes, unprotected, ciphertext])
  }
  return recipients
}

function assemble(protectedBytes: Uint8Array, recipients: CborValue[][]): PreparedEnvelope {
  const unprotectedMap = encodeUnprotectedHeader()
  const tag = recipients.length === 0 ? TAG_ENCRYPT0 : TAG_ENCRYPT

  const encoded =
    tag === TAG_ENCRYPT0
      ? cborEncode(new Tagged(TAG_ENCRYPT0, [protectedBytes, unprotectedMap, null]), rfc8949EncodeOptions)
      : cborEncode(new Tagged(TAG_ENCRYPT, [protectedBytes, unprotectedMap, null, recipients]), rfc8949EncodeOptions)

  if (encoded.length > MAX_ENVELOPE_SIZE) {
    throw new MalformedEnvelopeError(
      `Encoded envelope of ${encoded.length} bytes exceeds the ${MAX_ENVELOPE_SIZE}-byte decode ceiling.`
    )
  }

  return { bytes: encoded, protectedBytes, tag }
}

/**
 * `prepareEnvelope`, keeping only the encoded bytes. The caller appends the
 * detached ciphertext separately. See docs/tech-spec.md, "Blob layout".
 */
export function encodeEnvelope(input: EncodeEnvelopeInput): Uint8Array {
  return prepareEnvelope(input).bytes
}
