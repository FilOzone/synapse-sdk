/**
 * COSE protected and unprotected header encoding and decoding for this
 * envelope's wire profile (docs/tech-spec.md, "Wire profile" and "CDDL").
 *
 * Protected headers are CBOR maps carried as byte strings. Decoding preserves
 * the exact bytes in {@link DecodedProtectedHeader.bytes}; they must not be
 * re-encoded when building the Enc_structure. Header maps use `Map` because
 * labels may be negative integers; `appMetadata` accepts either representation.
 *
 * Validation is split into two layers:
 *
 * - {@link createStrictTokenizer} is decode-only. It inspects the wire bytes
 *   to reject representations whose distinction is lost after decoding, such
 *   as integer-valued floats and invalid or BOM-stripped UTF-8.
 * - {@link assertAllowlistedValue} validates decoded and caller-supplied trees,
 *   allowing only the CBOR shapes supported by this profile.
 *
 * This ensures everything accepted by `encodeEnvelope` can be read by
 * `decodeEnvelope`, while still allowing other valid profile encodings.
 */
import {
  decodeFirst as cborDecodeFirst,
  type DecodeOptions,
  decode,
  encode,
  rfc8949EncodeOptions,
  Tagged,
  Tokenizer,
  Type,
} from 'cborg'
import * as z from 'zod'
import { ciphertextLengthForPlaintext } from '../chunk-layout.ts'
import {
  ALG_AES_256_GCM,
  ALG_CHUNKED_AES_256_GCM_STREAM,
  BASE_NONCE_SIZE,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  NONCE_SIZE,
} from '../constants.ts'
import { CriticalHeaderError, MalformedEnvelopeError, UnsupportedSchemeError } from '../errors.ts'
import {
  ALG_A256KW,
  ALG_ECDH_ES_A256KW,
  ENVELOPE_TYPE,
  HEADER_ALG,
  HEADER_APP_METADATA,
  HEADER_CHUNK_SIZE,
  HEADER_CONTENT_TYPE,
  HEADER_CRIT,
  HEADER_IV,
  HEADER_KID,
  HEADER_PARTIAL_IV,
  HEADER_PLAINTEXT_LENGTH,
  HEADER_TYP,
  MAX_APP_METADATA_DEPTH,
} from './constants.ts'

/** One of the two content-encryption schemes supported by this package. */
export type Alg = typeof ALG_AES_256_GCM | typeof ALG_CHUNKED_AES_256_GCM_STREAM

/**
 * CBOR values supported by this profile.
 *
 * Decoding produces `Map` for CBOR maps, while `appMetadata` may use plain
 * objects when encoding. One type for both allows decoded values to be passed
 * back to the encoder.
 */
export type CborValue =
  | string
  | number
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>
  | CborValueObject

/**
 * Plain-object form of {@link CborValue}. Defined as an interface because
 * TypeScript does not allow this recursive type through `Record<string, CborValue>`.
 */
export interface CborValueObject {
  [key: string]: CborValue
}

/** Opaque, string-keyed application metadata. Carried but never interpreted. */
export type AppMetadata = Record<string, CborValue>

/** A decoded profile value, optionally wrapped in a supported CBOR tag. */
export type DecodedCborValue = CborValue | Tagged

/** Logical protected-header fields, independent of their CBOR encoding. */
export interface ProtectedHeaderFields {
  alg: Alg
  /** 12-byte IV for AES-256-GCM or 7-byte base nonce for the chunked scheme. */
  iv: Uint8Array
  contentType?: string | number
  /** Plaintext bytes per chunk. Required only for the chunked scheme. */
  chunkSize?: number
  /** Exact plaintext length, when known before encoding. Chunked scheme only. */
  plaintextLength?: number
  /** Opaque authenticated metadata. This package carries but does not interpret it. */
  appMetadata?: AppMetadata
}

/**
 * A decoded protected header with its original encoded bytes.
 * Use `bytes` verbatim when building the Enc_structure.
 */
export interface DecodedProtectedHeader extends ProtectedHeaderFields {
  bytes: Uint8Array
}

/**
 * Content unprotected header map.
 *
 * The encoder emits an empty map. Decoding accepts unknown non-critical
 * parameters, but rejects `crit`, Partial IV, and labels duplicated in the
 * protected header.
 */
export type UnprotectedHeaderMap = Map<CborValue, CborValue>

/** Validated logical fields from one recipient's protected and unprotected headers. */
export interface DecodedRecipientHeaders {
  /** Decoded protected map. Empty when the serialized protected field is `h''`. */
  protected: Map<CborValue, CborValue>
  alg: number | string
  /** Key identifier from either header bucket, when present. */
  kid?: Uint8Array
}

/**
 * Strict CBOR decoding for envelope data.
 *
 * Rejects duplicate keys, non-minimal integers, indefinite-length values,
 * `undefined`, and integers outside JavaScript's safe range. `useMaps`
 * preserves integer map labels, while `retainStringBytes` allows
 * {@link createStrictTokenizer} to validate the original UTF-8.
 */
export const DECODE_OPTIONS: DecodeOptions = {
  useMaps: true,
  strict: true,
  rejectDuplicateMapKeys: true,
  allowIndefinite: false,
  allowUndefined: false,
  allowBigInt: false,
  retainStringBytes: true,
}

const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * Add wire-level validation that cborg does not provide directly.
 *
 * Rejects CBOR floats because integer-valued floats become indistinguishable
 * from integers after decoding. It also re-decodes text from the original
 * bytes to reject invalid UTF-8 while preserving a leading BOM.
 *
 * Nesting depth is enforced here because deeply nested CBOR can exhaust the
 * parser stack before decoded-value validation runs.
 */
function createStrictTokenizer(data: Uint8Array, options: DecodeOptions) {
  const inner = new Tokenizer(data, options)
  // Track remaining items in each open container. The stack length is the
  // current CBOR nesting depth. Containers have known lengths because
  // indefinite-length CBOR is disabled.
  const open: number[] = []
  const closeFinished = (): void => {
    while (open.length > 0) {
      const top = open[open.length - 1]
      if (top === undefined || top > 0) {
        return
      }
      open.pop()
    }
  }
  return {
    done: () => inner.done(),
    pos: () => inner.pos(),
    next: () => {
      const token = inner.next()
      if (Type.equals(token.type, Type.float)) {
        throw new Error('CBOR float values are not permitted in this profile; expected an integer encoding.')
      }
      // Count this token as one item in its parent before opening the token's own container.
      if (open.length > 0) {
        const top = open[open.length - 1]
        if (top !== undefined) {
          open[open.length - 1] = top - 1
        }
      }
      const isArray = Type.equals(token.type, Type.array)
      const isMap = Type.equals(token.type, Type.map)
      // A tag contains one nested value and therefore contributes one depth level.
      const isTag = Type.equals(token.type, Type.tag)
      if (isArray || isMap || isTag) {
        // CBOR map lengths count pairs, so each entry contributes two tokens.
        const items = isTag ? 1 : isMap ? Number(token.value) * 2 : Number(token.value)
        if (open.length + 1 > MAX_APP_METADATA_DEPTH) {
          throw new Error(`CBOR nesting deeper than ${MAX_APP_METADATA_DEPTH} levels is not permitted by this profile.`)
        }
        open.push(items)
      }
      closeFinished()
      if (Type.equals(token.type, Type.string) && token.byteValue !== undefined) {
        try {
          // Assign the re-decoded string back onto the token, replacing
          // cborg's own value. cborg's default TextDecoder uses
          // `ignoreBOM: false` (the WHATWG default), which strips a
          // leading U+FEFF byte-order mark from the *first* chunk it
          // decodes — silent data modification for a text string that
          // legitimately starts with one. `ignoreBOM: true` is the
          // counterintuitive setting that *preserves* the BOM: it means
          // "do not treat a BOM specially" (WHATWG Encoding Standard).
          // `Token.value` is a plain, writable property (see cborg's
          // lib/token.js), and cborg reads it via `token.value` after
          // this tokenizer's `next()` returns (lib/decode.js's
          // `tokensToObject`), so overwriting it here is observed by
          // every caller — no separate re-encode step needed.
          token.value = STRICT_UTF8_DECODER.decode(token.byteValue)
        } catch {
          throw new Error('Invalid UTF-8 in a CBOR text string.')
        }
      }
      return token
    },
  }
}

/**
 * Decode exactly one CBOR value.
 *
 * The entire input must belong to that value; trailing bytes are rejected.
 * The strict tokenizer validates the wire representation before the decoded
 * tree is checked against the profile allowlist.
 */
export function decodeExact(data: Uint8Array): CborValue {
  const value: CborValue = decode(data, {
    ...DECODE_OPTIONS,
    tokenizer: createStrictTokenizer(data, DECODE_OPTIONS),
  })
  assertAllowlistedValue(value, 'decoded CBOR value')
  return value
}

/**
 * Decode the first CBOR value and return any remaining bytes.
 *
 * Used for `envelope ‖ ciphertext`, where trailing ciphertext is expected.
 * Callers may configure tag handling, but all strict decode options remain
 * enforced.
 */
export function decodeFirst(data: Uint8Array, extra?: Pick<DecodeOptions, 'tags'>): [DecodedCborValue, Uint8Array] {
  const [value, remainder]: [DecodedCborValue, Uint8Array] = cborDecodeFirst(data, {
    ...extra,
    ...DECODE_OPTIONS,
    tokenizer: createStrictTokenizer(data, DECODE_OPTIONS),
  })
  // The top-level tag contributes one enclosing level. Protected-header byte
  // strings remain opaque here and are validated separately by `decodeExact`.
  if (value instanceof Tagged) {
    assertAllowlistedValue(value.value, `CBOR tag ${value.tag} value`, 1)
  } else {
    assertAllowlistedValue(value, 'decoded CBOR value')
  }
  return [value, remainder]
}

// ── Field schemas ────────────────────────────────────────────────────────
//
// Used as predicates; validation errors remain profile-specific.

/** `alg` (label 1): supported content-encryption algorithms. */
const ALG_SCHEMA = z.union([z.literal(ALG_AES_256_GCM), z.literal(ALG_CHUNKED_AES_256_GCM_STREAM)])

/** `content_type` (label 3): `tstr / uint`. */
const CONTENT_TYPE_SCHEMA = z.union([z.string(), z.number().int().nonnegative()])

/** `chunk_size` (label -1): plaintext bytes per chunk within supported bounds. */
const CHUNK_SIZE_SCHEMA = z.number().int().min(MIN_CHUNK_SIZE).max(MAX_CHUNK_SIZE)

// `plaintext_length` (label -65789) gets no schema. It uses an explicit safe-integer check because the value is
// immediately used in layout arithmetic.

/**
 * Return a human-readable type name for validation errors.
 *
 * Accepts `unknown` because error paths may receive values outside the
 * supported CBOR value set {@link CborValue}, including class instances and JavaScript-only types.
 */
export function describeCborType(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (typeof value === 'bigint') {
    return 'bigint'
  }

  if (typeof value === 'symbol') {
    return 'symbol'
  }

  if (typeof value === 'function') {
    return 'function'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  if (value instanceof Uint8Array) {
    return 'byte string'
  }

  if (value instanceof Map) {
    return 'map'
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype === Object.prototype || prototype === null) {
      return 'object'
    }
    const ctor = (value as { constructor?: unknown }).constructor
    const ctorName = typeof ctor === 'function' ? ctor.name : undefined
    return ctorName ? `${ctorName} instance` : 'object instance'
  }

  return typeof value
}

/** The IV length this profile requires for `alg`: 12 bytes (scheme 1) or 7 bytes (chunked base nonce). */
export function ivLengthForAlg(alg: Alg): number {
  return alg === ALG_AES_256_GCM ? NONCE_SIZE : BASE_NONCE_SIZE
}

function assertKnownAlg(alg: CborValue | undefined): asserts alg is Alg {
  if (!ALG_SCHEMA.safeParse(alg).success) {
    throw new UnsupportedSchemeError(
      `Unsupported alg (1): ${String(alg)}. Expected ${ALG_AES_256_GCM} (AES-256-GCM) or ${ALG_CHUNKED_AES_256_GCM_STREAM} (chunked AES-256-GCM STREAM).`
    )
  }
}

function assertContentTypeValid(
  contentType: CborValue | undefined
): asserts contentType is string | number | undefined {
  if (contentType === undefined) {
    return
  }
  if (!CONTENT_TYPE_SCHEMA.safeParse(contentType).success) {
    throw new MalformedEnvelopeError(
      `Invalid content_type (3): ${describeCborType(contentType)}. Expected a string or a non-negative integer.`
    )
  }
  // Reject malformed UTF-16 before encoding, which would otherwise replace
  // unpaired surrogates with U+FFFD. Same rule as app_metadata strings.
  if (typeof contentType === 'string' && !contentType.isWellFormed()) {
    throw new MalformedEnvelopeError(
      `Invalid content_type (3): ${JSON.stringify(contentType)} contains an unpaired UTF-16 surrogate half — ` +
        'not well-formed Unicode. Encoding it would silently substitute U+FFFD.'
    )
  }
}

function assertChunkSizeValid(alg: Alg, chunkSize: CborValue | undefined): asserts chunkSize is number | undefined {
  const isChunked = alg === ALG_CHUNKED_AES_256_GCM_STREAM
  if (chunkSize === undefined) {
    if (isChunked) {
      throw new MalformedEnvelopeError('Missing chunk_size (-1): required when alg is the chunked scheme.')
    }
    return
  }
  if (!isChunked) {
    throw new MalformedEnvelopeError(
      `Unexpected chunk_size (-1): ${String(chunkSize)}. Forbidden when alg is ${ALG_AES_256_GCM} (whole-object AES-256-GCM has no chunk layout).`
    )
  }
  if (!CHUNK_SIZE_SCHEMA.safeParse(chunkSize).success) {
    throw new MalformedEnvelopeError(
      `Invalid chunk_size (-1): ${describeCborType(chunkSize)} ${String(chunkSize)}. Expected an integer between ${MIN_CHUNK_SIZE} and ${MAX_CHUNK_SIZE}.`
    )
  }
}

/**
 * Validate `iv` (label 5). Its length is determined by `alg`: 12 bytes for
 * AES-256-GCM or 7 bytes for the chunked scheme's base nonce.
 */
function assertIvValid(alg: Alg, iv: CborValue | undefined): asserts iv is Uint8Array {
  if (iv === undefined) {
    throw new MalformedEnvelopeError('Missing iv (5): required in every protected header.')
  }
  if (!(iv instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(`Invalid iv (5): expected a byte string, got ${describeCborType(iv)}.`)
  }
  const expectedLength = ivLengthForAlg(alg)
  if (iv.length !== expectedLength) {
    throw new MalformedEnvelopeError(
      `Invalid iv (5) length: ${iv.length}. Expected exactly ${expectedLength} bytes for alg ${alg}.`
    )
  }
}

/**
 * Validate `plaintext_length` (label -65789), an optional authenticated commitment
 * to the plaintext byte count.
 *
 * For the chunked scheme, also verify that the declared length and
 * `chunk_size` describe a supported ciphertext layout. Comparison with the
 * actual ciphertext length happens later, where the blob size is available.
 */
function assertPlaintextLengthValid(
  alg: Alg,
  chunkSize: number | undefined,
  plaintextLength: CborValue | undefined
): asserts plaintextLength is number | undefined {
  if (plaintextLength === undefined) {
    return
  }
  if (alg !== ALG_CHUNKED_AES_256_GCM_STREAM) {
    throw new MalformedEnvelopeError(
      `Unexpected plaintext_length (-65789): ${String(plaintextLength)}. Forbidden when alg is ${ALG_AES_256_GCM} (whole-object AES-256-GCM has no chunk layout to commit to).`
    )
  }
  if (typeof plaintextLength !== 'number' || !Number.isSafeInteger(plaintextLength) || plaintextLength < 0) {
    throw new MalformedEnvelopeError(
      `Invalid plaintext_length (-65789): ${describeCborType(plaintextLength)} ${String(plaintextLength)}. Expected a non-negative safe integer.`
    )
  }
  // `chunk_size` is required and validated before this point. Keep the guard
  // explicit rather than deriving a layout from an implicit default.
  if (chunkSize === undefined) {
    throw new MalformedEnvelopeError('Invalid plaintext_length (-65789): cannot be validated without chunk_size (-1).')
  }
  try {
    ciphertextLengthForPlaintext(plaintextLength, chunkSize)
  } catch (cause) {
    throw new MalformedEnvelopeError(
      `Invalid plaintext_length (-65789): ${plaintextLength} describes an unsupported chunk layout at chunk size ${chunkSize}.`,
      { cause }
    )
  }
}

/** Render bytes as hex for content-based map-key comparison. */
function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** Map-key types supported by this profile. */
function isAllowlistedMapKey(key: unknown): key is string | number | Uint8Array {
  return typeof key === 'string' || typeof key === 'number' || key instanceof Uint8Array
}

/**
 * Content-based identity for map keys.
 *
 * `Map` compares `Uint8Array` keys by object identity, so byte-equal keys
 * need an explicit representation. The type prefix keeps `"1"` distinct from `1`.
 */
function mapKeyIdentity(key: string | number | Uint8Array): string {
  return key instanceof Uint8Array ? `bytes:${bytesToHex(key)}` : `${typeof key}:${String(key)}`
}

/** True for plain or null-prototype objects, excluding class instances. */
function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Canonical non-negative integer property name. */
const INDEX_KEY = /^(0|[1-9][0-9]*)$/

/** True when `key` identifies an element within this container. */
function isElementIndex(key: string, length: number): boolean {
  return INDEX_KEY.test(key) && Number(key) < length
}

/**
 * Reject own properties that CBOR encoding would silently omit.
 *
 * Arrays, maps, and byte strings may carry extra JavaScript properties that
 * are not represented in their CBOR encoding.
 */
function assertNoUnencodableProperties(
  value: object,
  isExpected: (key: string) => boolean,
  kind: string,
  path: string
): void {
  const symbols = Object.getOwnPropertySymbols(value)
  const extra = Object.getOwnPropertyNames(value).filter((key) => !isExpected(key))
  if (symbols.length > 0 || extra.length > 0) {
    const named = [...extra, ...symbols.map(String)].join(', ')
    throw new MalformedEnvelopeError(
      `Invalid ${path}: a ${kind} carrying extra own properties (${named}) is not permitted. CBOR does not ` +
        'encode them, so they would be silently dropped.'
    )
  }
}

/**
 * Reject symbol and non-enumerable properties on plain objects.
 *
 * They are not visited by `Object.entries` and would therefore be silently
 * omitted during validation and encoding.
 */
function assertNoHiddenKeys(value: object, path: string): void {
  const symbols = Object.getOwnPropertySymbols(value)
  if (symbols.length > 0) {
    throw new MalformedEnvelopeError(
      `Invalid ${path}: symbol-keyed properties (${symbols.map(String).join(', ')}) are not a permitted ` +
        'shape this profile can encode. CBOR has no symbol keys, and encoding would silently drop them.'
    )
  }
  const nonEnumerable = Object.getOwnPropertyNames(value).filter(
    (key) => !Object.prototype.propertyIsEnumerable.call(value, key)
  )
  if (nonEnumerable.length > 0) {
    throw new MalformedEnvelopeError(
      `Invalid ${path}: non-enumerable properties (${nonEnumerable.join(', ')}) are not permitted. Encoding ` +
        'walks enumerable own properties, so these would be silently dropped.'
    )
  }
}

/**
 * Reject accessor properties before reading caller-supplied CBOR values.
 *
 * Validation and encoding are separate passes, so a getter could return
 * different values between them. Metadata is restricted to data properties.
 */
function assertNoAccessors(value: object, path: string): void {
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor !== undefined && !Object.hasOwn(descriptor, 'value')) {
      throw new MalformedEnvelopeError(
        `Invalid ${path}.${String(key)}: getter and setter properties are not permitted in caller-supplied CBOR values.`
      )
    }
  }
}

/**
 * Recursive implementation of {@link assertAllowlistedValue}.
 *
 * `seen` tracks the current path to detect cycles, while `depth` bounds
 * deeply nested but acyclic values.
 */
function walkAllowlistedValue(value: unknown, path: string, seen: WeakSet<object>, depth: number): void {
  // Charge the container itself against the nesting limit, matching the
  // decoder's tokenizer.
  const enterContainer = (): void => {
    if (depth + 1 > MAX_APP_METADATA_DEPTH) {
      throw new MalformedEnvelopeError(
        `Invalid ${path}: nesting exceeds this library's depth limit of ${MAX_APP_METADATA_DEPTH} levels. This is ` +
          'a library resource limit protecting against unbounded recursion, not a COSE or FIP format rule.'
      )
    }
  }

  if (typeof value === 'string') {
    if (!value.isWellFormed()) {
      throw new MalformedEnvelopeError(
        `Invalid ${path}: string contains an unpaired UTF-16 surrogate half — not well-formed Unicode, and this ` +
          'library will not silently corrupt it into U+FFFD by encoding it anyway.'
      )
    }
    return
  }

  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
      return
    }
    throw new MalformedEnvelopeError(
      `Invalid ${path}: ${describeCborType(value)} ${String(value)}. This library currently accepts only ` +
        'safe-integer numbers in profile values — a library restriction, not a COSE requirement or an adopted FIP ' +
        'rule. NaN, Infinity, -Infinity, fractional numbers, and -0 are all rejected.'
    )
  }

  if (typeof value === 'boolean' || value === null) {
    return
  }

  if (value instanceof Uint8Array) {
    assertNoUnencodableProperties(value, (key) => isElementIndex(key, value.length), 'a byte string', path)
    return
  }

  if (Array.isArray(value)) {
    assertNoUnencodableProperties(
      value,
      (key) => key === 'length' || isElementIndex(key, value.length),
      'an array',
      path
    )
    enterContainer()
    if (seen.has(value)) {
      throw new MalformedEnvelopeError(`Invalid ${path}: cyclic structure detected.`)
    }
    assertNoAccessors(value, path)
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) {
        throw new MalformedEnvelopeError(
          `Invalid ${path}[${index}]: sparse array (missing element) has no CBOR representation.`
        )
      }
    }
    seen.add(value)
    for (let index = 0; index < value.length; index++) {
      walkAllowlistedValue(value[index], `${path}[${index}]`, seen, depth + 1)
    }
    seen.delete(value)
    return
  }

  if (value instanceof Map) {
    assertNoUnencodableProperties(value, () => false, 'a Map', path)
    enterContainer()
    if (seen.has(value)) {
      throw new MalformedEnvelopeError(`Invalid ${path}: cyclic structure detected.`)
    }
    const seenKeys = new Set<string>()
    for (const key of value.keys()) {
      if (!isAllowlistedMapKey(key)) {
        throw new MalformedEnvelopeError(
          `Invalid ${path} map key: ${describeCborType(key)}. Map keys must be a well-formed string, a safe ` +
            'integer, or a byte string — arrays and maps are not permitted as keys.'
        )
      }
      if (typeof key === 'string' && !key.isWellFormed()) {
        throw new MalformedEnvelopeError(`Invalid ${path} map key ${JSON.stringify(key)}: not well-formed Unicode.`)
      }
      if (typeof key === 'number' && (!Number.isSafeInteger(key) || Object.is(key, -0))) {
        throw new MalformedEnvelopeError(
          `Invalid ${path} map key ${String(key)}: expected a safe integer, excluding -0.`
        )
      }
      const identity = mapKeyIdentity(key)
      if (seenKeys.has(identity)) {
        throw new MalformedEnvelopeError(
          `Invalid ${path}: duplicate map key by content (${identity}). A JS Map compares byte-string keys by ` +
            'identity, not content, so two byte-equal keys would otherwise be silently retained as separate entries.'
        )
      }
      seenKeys.add(identity)
    }
    seen.add(value)
    for (const [key, entryValue] of value) {
      // Map keys were validated above; use a stable representation in error paths.
      const label = key instanceof Uint8Array ? `bytes:${bytesToHex(key)}` : String(key)
      walkAllowlistedValue(entryValue, `${path}[${label}]`, seen, depth + 1)
    }
    seen.delete(value)
    return
  }

  if (typeof value === 'object') {
    if (!isPlainObject(value)) {
      throw new MalformedEnvelopeError(
        `Invalid ${path}: ${describeCborType(value)} is not a shape this profile can encode.`
      )
    }
    enterContainer()
    if (seen.has(value)) {
      throw new MalformedEnvelopeError(`Invalid ${path}: cyclic structure detected.`)
    }
    seen.add(value)
    assertNoHiddenKeys(value, path)
    assertNoAccessors(value, path)
    for (const [key, entryValue] of Object.entries(value)) {
      if (!key.isWellFormed()) {
        throw new MalformedEnvelopeError(`Invalid ${path}.${key}: object key is not well-formed Unicode.`)
      }
      walkAllowlistedValue(entryValue, `${path}.${key}`, seen, depth + 1)
    }
    seen.delete(value)
    return
  }

  throw new MalformedEnvelopeError(
    `Invalid ${path}: ${describeCborType(value)} is not a value this profile can encode.`
  )
}

/**
 * Validate a value against the profile's CBOR allowlist.
 *
 * Supports well-formed strings, safe integers except `-0`, booleans, `null`,
 * byte strings, dense arrays, maps with supported unique keys, and plain
 * objects. `path` identifies nested values in validation errors.
 *
 * Validation and encoding are separate passes. Accessors and hidden
 * properties are rejected, but deliberately unstable values such as proxies
 * remain the caller's responsibility.
 */
export function assertAllowlistedValue(value: unknown, path: string, enclosingDepth = 0): void {
  walkAllowlistedValue(value, path, new WeakSet<object>(), enclosingDepth)
}

/**
 * Existing container depth before entering an `app_metadata` value:
 * protected-header map → `app_metadata` map.
 */
const APP_METADATA_ENCLOSING_DEPTH = 2

/**
 * Existing container depth before entering the content unprotected map:
 * envelope tag → envelope array.
 */
const UNPROTECTED_ENCLOSING_DEPTH = 2

/**
 * Validate `app_metadata`: a plain object with well-formed string keys and
 * values accepted by {@link assertAllowlistedValue}.
 */
function assertValidAppMetadata(entries: Record<string, CborValue>): void {
  // Validate the root explicitly because `Object.entries` alone would allow
  // non-record values such as arrays or maps to bypass entry validation.
  if (entries === null || typeof entries !== 'object' || !isPlainObject(entries)) {
    throw new MalformedEnvelopeError(
      `Invalid app_metadata (-65792): expected a plain object with string keys, got ${describeCborType(entries)}. ` +
        'A Map, an array, a typed array, or any other class instance is not a valid app_metadata root.'
    )
  }
  assertNoHiddenKeys(entries, 'app_metadata (-65792)')
  assertNoAccessors(entries, 'app_metadata (-65792)')
  for (const [key, value] of Object.entries(entries)) {
    if (!key.isWellFormed()) {
      throw new MalformedEnvelopeError(
        `Invalid app_metadata (-65792) key ${JSON.stringify(key)}: contains an unpaired UTF-16 surrogate half — ` +
          'not well-formed Unicode. Every string in app_metadata, keys included, must be well-formed before encoding.'
      )
    }
    assertAllowlistedValue(value, `app_metadata.${key}`, APP_METADATA_ENCLOSING_DEPTH)
  }
}

/**
 * Decode `app_metadata` into a null-prototype object so keys such as
 * `__proto__` remain ordinary own properties.
 */
function decodeAppMetadata(value: CborValue): Record<string, CborValue> {
  if (!(value instanceof Map)) {
    throw new MalformedEnvelopeError(
      `Invalid app_metadata (-65792): expected a CBOR map, got ${describeCborType(value)}.`
    )
  }
  const result: Record<string, CborValue> = Object.create(null)
  for (const [key, entryValue] of value) {
    if (typeof key !== 'string') {
      throw new MalformedEnvelopeError(
        `Invalid app_metadata (-65792) key: expected a string, got ${describeCborType(key)}.`
      )
    }
    result[key] = entryValue
  }
  assertValidAppMetadata(result)
  return result
}

/**
 * Validate COSE header labels. RFC 9052 permits only integer and text-string
 * labels, including unknown parameters.
 */
function assertValidLabels(map: Map<CborValue, CborValue>, location: string): void {
  for (const key of map.keys()) {
    const isValidLabel = typeof key === 'string' || (typeof key === 'number' && Number.isInteger(key))
    if (!isValidLabel) {
      throw new MalformedEnvelopeError(
        `Invalid header label in the ${location} header: ${describeCborType(key)}. COSE labels (RFC 9052 §3.1) must be an integer or a text string.`
      )
    }
  }
}

/** Reject Partial IV (6), which is not supported by this profile. */
function assertNoPartialIv(map: Map<CborValue, CborValue>, location: 'protected' | 'unprotected'): void {
  if (map.has(HEADER_PARTIAL_IV)) {
    throw new MalformedEnvelopeError(
      `Invalid Partial IV (6) in the ${location} header: not supported by this profile — the base nonce and iv ` +
        'are not COSE Partial IV reconstruction.'
    )
  }
}

/**
 * Content-header labels this profile can process when listed in `crit`.
 * `crit` itself is excluded because listing it would be circular.
 */
const UNDERSTOOD_CRIT_LABELS: ReadonlySet<number> = new Set([
  HEADER_ALG,
  HEADER_CONTENT_TYPE,
  HEADER_IV,
  HEADER_CHUNK_SIZE,
  HEADER_TYP,
  HEADER_PLAINTEXT_LENGTH,
  HEADER_APP_METADATA,
])

/**
 * Validate content-header `crit` (2).
 *
 * `crit` must appear only in the protected header. Every listed label must
 * be understood by this profile and present in that same protected map.
 */
function assertCritHeaderSatisfied(map: Map<CborValue, CborValue>, location: 'protected' | 'unprotected'): void {
  if (!map.has(HEADER_CRIT)) {
    return
  }
  if (location === 'unprotected') {
    throw new CriticalHeaderError(
      'Invalid crit (2) in the unprotected header: RFC 9052 requires crit to appear only in the protected header.'
    )
  }
  assertCritSatisfiedBy(map, UNDERSTOOD_CRIT_LABELS, 'the protected header')
}

/**
 * Recipient-header labels understood when listed in `crit`.
 *
 * Recipient processing understands `alg` and `kid`; content-header labels
 * do not apply at this layer.
 */
const UNDERSTOOD_RECIPIENT_CRIT_LABELS: ReadonlySet<number> = new Set([HEADER_ALG, HEADER_KID])

/**
 * Validate a protected `crit` list against the labels understood at this
 * security layer. The list must be non-empty, understood, and present in the
 * same protected map.
 */
function assertCritSatisfiedBy(
  protectedMap: Map<CborValue, CborValue>,
  understood: ReadonlySet<number>,
  location: string
): void {
  const crit = protectedMap.get(HEADER_CRIT)
  if (!Array.isArray(crit) || crit.length === 0) {
    throw new CriticalHeaderError(
      `Invalid crit (2) in ${location}: expected a nonempty array of labels, got ${describeCborType(crit)}.`
    )
  }
  const unsatisfied = crit.filter(
    (label) => !(typeof label === 'number' && understood.has(label) && protectedMap.has(label))
  )
  if (unsatisfied.length > 0) {
    throw new CriticalHeaderError(
      `Unsupported critical headers (crit, label 2) in ${location}: [${unsatisfied.map(String).join(', ')}]. ` +
        'Every crit label must be understood by this profile and actually present in the same protected map.'
    )
  }
}

/**
 * Reject labels present in both protected and unprotected maps.
 *
 * Rather than applying RFC 9052's protected-value preference, this profile
 * treats cross-bucket duplication as malformed.
 */
function assertNoLabelOverlap(
  protectedMap: Map<CborValue, CborValue>,
  unprotectedMap: Map<CborValue, CborValue>
): void {
  for (const key of protectedMap.keys()) {
    if (unprotectedMap.has(key)) {
      throw new MalformedEnvelopeError(
        `Invalid header: label ${String(key)} appears in both the protected and unprotected maps. This profile ` +
          'rejects a label duplicated across buckets instead of preferring the protected value.'
      )
    }
  }
}

/**
 * Encode the protected header as a deterministically encoded CBOR map.
 *
 * Deterministic encoding provides stable bytes and test vectors; authentication
 * still uses the exact protected bytes carried by each envelope.
 */
export function encodeProtectedHeader(fields: ProtectedHeaderFields): Uint8Array {
  if (fields === null || typeof fields !== 'object') {
    throw new MalformedEnvelopeError(
      `Invalid protected header fields: expected an object, got ${describeCborType(fields)}.`
    )
  }
  // Snapshot each field once so validation and encoding use the same values,
  // including when the caller's options object uses getters.
  const { alg, iv, contentType, chunkSize, plaintextLength, appMetadata } = fields

  assertKnownAlg(alg)
  assertIvValid(alg, iv)
  assertContentTypeValid(contentType)
  assertChunkSizeValid(alg, chunkSize)
  assertPlaintextLengthValid(alg, chunkSize, plaintextLength)
  if (appMetadata !== undefined) {
    assertValidAppMetadata(appMetadata)
  }

  const map = new Map<number, Alg | string | number | Uint8Array | Record<string, CborValue>>()
  map.set(HEADER_ALG, alg)
  map.set(HEADER_TYP, ENVELOPE_TYPE)
  map.set(HEADER_IV, iv)
  if (contentType !== undefined) {
    map.set(HEADER_CONTENT_TYPE, contentType)
  }
  if (chunkSize !== undefined) {
    map.set(HEADER_CHUNK_SIZE, chunkSize)
  }
  if (plaintextLength !== undefined) {
    map.set(HEADER_PLAINTEXT_LENGTH, plaintextLength)
  }
  if (appMetadata !== undefined) {
    map.set(HEADER_APP_METADATA, appMetadata)
  }
  return encode(map, rfc8949EncodeOptions)
}

/**
 * Decode a protected header from its exact wire bytes and preserve those bytes
 * in {@link DecodedProtectedHeader}.
 *
 * When provided, `unprotectedMap` is used to reject labels duplicated across
 * the protected and unprotected buckets.
 */
export function decodeProtectedHeader(
  bytes: Uint8Array,
  unprotectedMap?: Map<CborValue, CborValue>
): DecodedProtectedHeader {
  let map: CborValue
  try {
    map = decodeExact(bytes)
  } catch (cause) {
    throw new MalformedEnvelopeError('Malformed protected header: not a single well-formed CBOR map.', { cause })
  }
  if (!(map instanceof Map)) {
    throw new MalformedEnvelopeError(`Malformed protected header: expected a CBOR map, got ${describeCborType(map)}.`)
  }

  assertValidLabels(map, 'protected')
  assertNoPartialIv(map, 'protected')
  assertCritHeaderSatisfied(map, 'protected')
  if (unprotectedMap !== undefined) {
    assertNoLabelOverlap(map, unprotectedMap)
  }

  if (!map.has(HEADER_ALG)) {
    throw new MalformedEnvelopeError('Missing alg (1): required in every protected header.')
  }
  const alg = map.get(HEADER_ALG)
  assertKnownAlg(alg)

  if (!map.has(HEADER_TYP)) {
    throw new MalformedEnvelopeError('Missing typ (16): required in every protected header.')
  }
  const typ = map.get(HEADER_TYP)
  if (typ !== ENVELOPE_TYPE) {
    throw new MalformedEnvelopeError(
      `Invalid typ (16): ${describeCborType(typ)} ${String(typ)}. Expected "${ENVELOPE_TYPE}".`
    )
  }

  const iv = map.get(HEADER_IV)
  assertIvValid(alg, iv)

  const contentType = map.get(HEADER_CONTENT_TYPE)
  assertContentTypeValid(contentType)

  const chunkSize = map.get(HEADER_CHUNK_SIZE)
  assertChunkSizeValid(alg, chunkSize)

  const plaintextLength = map.get(HEADER_PLAINTEXT_LENGTH)
  assertPlaintextLengthValid(alg, chunkSize, plaintextLength)

  const appMetadataRaw = map.get(HEADER_APP_METADATA)
  const appMetadata = appMetadataRaw === undefined ? undefined : decodeAppMetadata(appMetadataRaw)

  const result: DecodedProtectedHeader = { alg, iv, bytes }
  if (contentType !== undefined) {
    result.contentType = contentType
  }
  if (chunkSize !== undefined) {
    result.chunkSize = chunkSize
  }
  if (plaintextLength !== undefined) {
    result.plaintextLength = plaintextLength
  }
  if (appMetadata !== undefined) {
    result.appMetadata = appMetadata
  }
  return result
}

/**
 * Validate the protected and unprotected headers of a `COSE_recipient`
 * without unwrapping its key.
 *
 * Unsupported recipient algorithms may be skipped only after the recipient
 * is structurally well formed. This validates its CBOR, header labels,
 * `crit`, bucket overlap, and known algorithm placement rules.
 *
 * A protected recipient header is either `h''` or one serialized CBOR map.
 * A256KW specifically requires `h''`.
 */
export function decodeRecipientHeaders(
  protectedBytes: Uint8Array,
  unprotected: Map<CborValue, CborValue>,
  path: string
): DecodedRecipientHeaders {
  // Validate runtime types as well as TypeScript types so the encoder cannot
  // produce recipient shapes its decoder would reject.
  if (!(protectedBytes instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(
      `Invalid ${path}.protected: expected a byte string, got ${describeCborType(protectedBytes)}.`
    )
  }
  if (!(unprotected instanceof Map)) {
    throw new MalformedEnvelopeError(
      `Invalid ${path}.unprotected: expected a Map of header labels, got ${describeCborType(unprotected)}.`
    )
  }

  let protectedMap: Map<CborValue, CborValue> | undefined
  if (protectedBytes.length > 0) {
    let decoded: CborValue
    try {
      decoded = decodeExact(protectedBytes)
    } catch (cause) {
      throw new MalformedEnvelopeError(
        `Malformed ${path}.protected: not a zero-length byte string and not a single well-formed CBOR item.`,
        { cause }
      )
    }
    if (!(decoded instanceof Map)) {
      throw new MalformedEnvelopeError(
        `Malformed ${path}.protected: expected a serialized CBOR map or a zero-length byte string, got ${describeCborType(decoded)}.`
      )
    }
    protectedMap = decoded
    assertValidLabels(protectedMap, `${path}.protected`)
    if (protectedMap.has(HEADER_CRIT)) {
      assertCritSatisfiedBy(protectedMap, UNDERSTOOD_RECIPIENT_CRIT_LABELS, `${path}.protected`)
    }
  }

  assertValidLabels(unprotected, `${path}.unprotected`)

  // RFC 9052 requires `crit` to be protected. For A256KW the protected field
  // must be `h''`, so `crit` cannot appear at all.
  if (unprotected.has(HEADER_CRIT)) {
    throw new CriticalHeaderError(
      `Invalid crit (2) in ${path}.unprotected: RFC 9052 requires crit to appear only in a protected header.`
    )
  }

  // `kid` (4) is a byte string in either recipient header bucket.
  const protectedKid = protectedMap?.get(HEADER_KID)

  if (protectedKid !== undefined && !(protectedKid instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(
      `Invalid kid (4) in ${path}.protected: expected a byte string, got ${describeCborType(protectedKid)}.`
    )
  }

  const unprotectedKid = unprotected?.get(HEADER_KID)

  if (unprotectedKid !== undefined && !(unprotectedKid instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(
      `Invalid kid (4) in ${path}.unprotected: expected a byte string, got ${describeCborType(unprotectedKid)}.`
    )
  }

  if (protectedMap !== undefined) {
    for (const key of protectedMap.keys()) {
      if (unprotected.has(key)) {
        throw new MalformedEnvelopeError(
          `Invalid ${path}: label ${String(key)} appears in both its protected and unprotected maps.`
        )
      }
    }
  }

  const algInProtected = protectedMap?.has(HEADER_ALG) === true
  const alg = algInProtected ? protectedMap?.get(HEADER_ALG) : unprotected.get(HEADER_ALG)
  if (alg === undefined) {
    throw new MalformedEnvelopeError(`Missing alg (1) in ${path}: every COSE_recipient must name its algorithm.`)
  }
  if (!((typeof alg === 'number' && Number.isInteger(alg)) || typeof alg === 'string')) {
    throw new MalformedEnvelopeError(
      `Invalid alg (1) in ${path}: ${describeCborType(alg)}. Expected an integer or text-string algorithm identifier.`
    )
  }

  // Enforce placement for algorithms whose header rules are defined, including
  // deferred algorithms. Unknown identifiers are left for the key-unwrapping
  // layer to skip.
  if (alg === ALG_A256KW) {
    if (protectedBytes.length !== 0) {
      throw new MalformedEnvelopeError(
        `Invalid ${path}.protected: A256KW (${ALG_A256KW}) requires a zero-length protected field (h''), got ${protectedBytes.length} bytes.`
      )
    }
    if (algInProtected) {
      throw new MalformedEnvelopeError(
        `Invalid ${path}: A256KW (${ALG_A256KW}) requires alg (1) in the unprotected map.`
      )
    }
  }
  // ECDH-ES+A256KW requires `alg` in the protected map because those bytes are
  // part of its COSE_KDF_Context.
  if (alg === ALG_ECDH_ES_A256KW && !algInProtected) {
    throw new MalformedEnvelopeError(
      `Invalid ${path}: ECDH-ES+A256KW (${ALG_ECDH_ES_A256KW}) requires alg (1) in the protected map, not the unprotected one.`
    )
  }

  const kid = protectedMap?.get(HEADER_KID) ?? unprotected.get(HEADER_KID)
  return {
    protected: protectedMap ?? new Map(),
    alg,
    ...(kid instanceof Uint8Array ? { kid } : {}),
  }
}

/** Validate a recipient's header buckets without retaining their decoded fields. */
export function assertValidRecipientHeaders(
  protectedBytes: Uint8Array,
  unprotected: Map<CborValue, CborValue>,
  path: string
): void {
  decodeRecipientHeaders(protectedBytes, unprotected, path)
}

/**
 * Build the content unprotected header. This profile defines no unprotected
 * content parameters, so the encoder always emits a new empty map.
 */
export function encodeUnprotectedHeader(): UnprotectedHeaderMap {
  return new Map()
}

/**
 * Validate and return the content unprotected header.
 *
 * Unknown non-critical parameters are allowed. `crit`, Partial IV, and IV
 * are rejected; cross-bucket label duplication is checked when the protected
 * header is decoded.
 */
export function decodeUnprotectedHeader(value: CborValue): UnprotectedHeaderMap {
  if (!(value instanceof Map)) {
    throw new MalformedEnvelopeError(
      `Malformed unprotected header: expected a CBOR map, got ${describeCborType(value)}.`
    )
  }
  assertValidLabels(value, 'unprotected')
  assertNoPartialIv(value, 'unprotected')
  assertCritHeaderSatisfied(value, 'unprotected')
  // Envelope decoding already validates this tree. Keep the check here because
  // this exported helper may also receive a decoded map directly.
  assertAllowlistedValue(value, 'unprotected header', UNPROTECTED_ENCLOSING_DEPTH)
  if (value.has(HEADER_IV)) {
    throw new MalformedEnvelopeError(
      'Invalid iv (5) in the unprotected header: this profile requires the IV in the protected header, so that ' +
        'it is covered by the content AAD (FIP amendment 3).'
    )
  }
  return value
}
