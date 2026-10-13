/**
 * Decode an envelope from untrusted bytes into a typed structure.
 *
 * Decoding does not authenticate the envelope. AEAD verification happens
 * in the layer above and covers the protected header bytes and ciphertext,
 * not the unprotected header or recipient list.
 * See docs/tech-spec.md, "Security properties".
 */
import { Tagged } from 'cborg'
import * as z from 'zod'
import { MalformedEnvelopeError } from '../errors.ts'
import { MAX_ENVELOPE_SIZE, TAG_ENCRYPT, TAG_ENCRYPT0 } from './constants.ts'
import type { CborValue, DecodedCborValue, DecodedProtectedHeader, UnprotectedHeaderMap } from './headers.ts'
import {
  assertRecipientCiphertext,
  decodeFirst,
  decodeProtectedHeader,
  decodeRecipientHeaders,
  decodeUnprotectedHeader,
  describeCborType,
} from './headers.ts'

// ── Body schemas ────────────────────────────────────────────────────────
//
// Both envelope types start with `[protected, unprotected, ciphertext]`.
// Ciphertext is always `null` because this profile uses detached ciphertext.
// `COSE_Encrypt` (tag 96) also includes a non-empty recipients array.

/** Use `z.custom` to preserve the `Map<CborValue, CborValue>` type. */
const CBOR_MAP_SCHEMA = z.custom<Map<CborValue, CborValue>>((value) => value instanceof Map, 'Expected a CBOR map')

const RECIPIENT_SCHEMA = z.tuple([z.instanceof(Uint8Array), CBOR_MAP_SCHEMA, z.instanceof(Uint8Array)])
const RECIPIENTS_SCHEMA = z.array(RECIPIENT_SCHEMA).min(1, 'recipients must not be empty for tag 96 (COSE_Encrypt)')
const TAG0_BODY_SCHEMA = z.tuple([z.instanceof(Uint8Array), CBOR_MAP_SCHEMA, z.null()])
const TAG_BODY_SCHEMA = z.tuple([z.instanceof(Uint8Array), CBOR_MAP_SCHEMA, z.null(), RECIPIENTS_SCHEMA])

/** Tuple produced by {@link RECIPIENT_SCHEMA}. */
type RecipientTuple = z.infer<typeof RECIPIENT_SCHEMA>

/** A decoded `COSE_recipient`. No key unwrapping happens at this layer. */
export interface DecodedRecipient {
  /**
   * Serialized protected header bytes, or `h''` when empty.
   * Header structure and placement have already been validated.
   */
  protectedBytes: Uint8Array
  /** Decoded and validated protected map. Empty when `protectedBytes` is `h''`. */
  protected: Map<CborValue, CborValue>
  unprotected: Map<CborValue, CborValue>
  /** Recipient algorithm identifier from the validated header buckets. */
  alg: number | string
  /** Recipient key identifier, when present in either header bucket. */
  kid?: Uint8Array
  /** Wrapped key material. */
  ciphertext: Uint8Array
}

export interface DecodedEnvelope {
  tag: typeof TAG_ENCRYPT0 | typeof TAG_ENCRYPT
  protectedHeader: DecodedProtectedHeader
  /**
   * The unprotected header as received. Envelopes written by this library
   * leave it empty, but decoded envelopes may contain unknown non-critical
   * parameters.
   */
  unprotectedHeader: UnprotectedHeaderMap
  /** Empty for tag 16; contains at least one recipient for tag 96. */
  recipients: DecodedRecipient[]
  /** Offset where the envelope ends and the detached ciphertext begins. */
  envelopeLength: number
}

function assertEnvelopeTag(tag: number): asserts tag is typeof TAG_ENCRYPT0 | typeof TAG_ENCRYPT {
  if (tag !== TAG_ENCRYPT0 && tag !== TAG_ENCRYPT) {
    throw new MalformedEnvelopeError(
      `Malformed envelope: expected CBOR tag ${TAG_ENCRYPT0} (COSE_Encrypt0) or ${TAG_ENCRYPT} (COSE_Encrypt), got tag ${tag}.`
    )
  }
}

/** Parse a body schema and convert validation failures to `MalformedEnvelopeError`. */
function parseBody<T>(schema: z.ZodType<T>, value: CborValue, context: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new MalformedEnvelopeError(`Malformed envelope: ${context}.\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    })
  }
  return result.data
}

function toRecipient([protectedBytes, unprotected, ciphertext]: RecipientTuple, index: number): DecodedRecipient {
  const headers = decodeRecipientHeaders(protectedBytes, unprotected, `recipients[${index}]`)
  assertRecipientCiphertext(headers.alg, ciphertext, `recipients[${index}]`)
  return {
    protectedBytes,
    protected: headers.protected,
    unprotected,
    alg: headers.alg,
    ...(headers.kid === undefined ? {} : { kid: headers.kid }),
    ciphertext,
  }
}

/**
 * Decode the envelope at the start of `data`.
 * Bytes after `envelopeLength` are untouched detached ciphertext.
 */
export function decodeEnvelope(data: Uint8Array): DecodedEnvelope {
  if (!(data instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(`Invalid envelope input: expected a Uint8Array, got ${describeCborType(data)}.`)
  }

  // Limit the bytes passed to the CBOR decoder. This bounds declared lengths
  // and allocations from the encoded input, although decoded structures may
  // still require more memory than their encoded representation.
  const candidate = data.length > MAX_ENVELOPE_SIZE ? data.subarray(0, MAX_ENVELOPE_SIZE) : data

  let decoded: DecodedCborValue
  let remainder: Uint8Array
  try {
    ;[decoded, remainder] = decodeFirst(candidate, {
      tags: Tagged.preserve(TAG_ENCRYPT0, TAG_ENCRYPT),
    })
  } catch (cause) {
    throw new MalformedEnvelopeError(
      `Malformed envelope: could not decode a COSE_Encrypt0 (tag ${TAG_ENCRYPT0}) or COSE_Encrypt (tag ${TAG_ENCRYPT}) ` +
        `structure within the first ${MAX_ENVELOPE_SIZE} bytes.`,
      { cause }
    )
  }

  if (!(decoded instanceof Tagged)) {
    throw new MalformedEnvelopeError(
      `Malformed envelope: expected CBOR tag ${TAG_ENCRYPT0} (COSE_Encrypt0) or ${TAG_ENCRYPT} (COSE_Encrypt) at the top level.`
    )
  }
  const { tag } = decoded
  assertEnvelopeTag(tag)

  let protectedBytes: Uint8Array
  let unprotectedRaw: Map<CborValue, CborValue>
  let recipients: DecodedRecipient[]
  if (tag === TAG_ENCRYPT) {
    const context = `tag ${tag} content must be [protected: bstr, unprotected: map, ciphertext: null, recipients: [+COSE_recipient]]`
    const [parsedProtectedBytes, parsedUnprotected, , recipientTuples] = parseBody(
      TAG_BODY_SCHEMA,
      decoded.value,
      context
    )
    protectedBytes = parsedProtectedBytes
    unprotectedRaw = parsedUnprotected
    // The schema validates each tuple's outer shape. `toRecipient` validates
    // and retains its headers before key-unwrapping code can inspect it.
    recipients = recipientTuples.map(toRecipient)
  } else {
    const context = 'tag 16 content must be [protected: bstr, unprotected: map, ciphertext: null]'
    const [parsedProtectedBytes, parsedUnprotected] = parseBody(TAG0_BODY_SCHEMA, decoded.value, context)
    protectedBytes = parsedProtectedBytes
    unprotectedRaw = parsedUnprotected
    recipients = []
  }

  // Pass both header buckets together so duplicate labels can be rejected.
  const protectedHeader = decodeProtectedHeader(protectedBytes, unprotectedRaw)
  const unprotectedHeader = decodeUnprotectedHeader(unprotectedRaw)

  return {
    tag,
    protectedHeader,
    unprotectedHeader,
    recipients,
    envelopeLength: candidate.length - remainder.length,
  }
}
