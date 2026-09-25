import assert from 'node:assert'
import {
  ALG_AES_256_GCM,
  ALG_CHUNKED_AES_256_GCM_STREAM,
  MAX_CHUNK_SIZE,
  MAX_ENCODED_OBJECT_SIZE,
  MIN_CHUNK_SIZE,
} from '../src/constants.ts'
import { ENVELOPE_TYPE, MAX_APP_METADATA_DEPTH } from '../src/cose/constants.ts'
import type { CborValue, ProtectedHeaderFields } from '../src/cose/headers.ts'
import {
  decodeProtectedHeader,
  decodeUnprotectedHeader,
  encodeProtectedHeader,
  encodeUnprotectedHeader,
} from '../src/cose/headers.ts'
import { CriticalHeaderError, MalformedEnvelopeError, UnsupportedSchemeError } from '../src/errors.ts'
import {
  FIXTURE_BASE_NONCE_7,
  FIXTURE_IV_12,
  hexToBytes,
  MINIMAL_PROTECTED_HEADER_HEX,
  toNullProto,
  utf8Bytes,
} from './cose-fixtures.ts'

const MINIMAL_ALG3: ProtectedHeaderFields = { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 }
const MINIMAL_CHUNKED: ProtectedHeaderFields = {
  alg: ALG_CHUNKED_AES_256_GCM_STREAM,
  iv: FIXTURE_BASE_NONCE_7,
  chunkSize: MIN_CHUNK_SIZE,
}

// Hand-built protected-header fragments, reused across the rejection-path
// tests below. `ALG3_ENTRY` and `TYP_ENTRY` are the two required entries;
// `APP_METADATA_KEY_BYTES` is label -65792 encoded as a 4-byte negative int
// (RFC 9052 §3.1's `int` range needs it, since -65792 doesn't fit in 1 byte).
const ALG3_ENTRY = [0x01, 0x03]
const IV_ENTRY = [0x05, 0x4c, ...FIXTURE_IV_12]
const TYP_ENTRY = [0x10, 0x78, 0x28, ...utf8Bytes(ENVELOPE_TYPE)]
const APP_METADATA_KEY_BYTES = [0x3a, 0x00, 0x01, 0x00, 0xff]

/** A protected header map with the three required entries (`alg`, `iv`, `typ`) plus `extraEntries` appended verbatim. */
function buildProtectedHeader(extraEntryCount: number, ...extraEntries: number[]): Uint8Array {
  const totalEntries = 3 + extraEntryCount
  return Uint8Array.from([0xa0 | totalEntries, ...ALG3_ENTRY, ...IV_ENTRY, ...TYP_ENTRY, ...extraEntries])
}

describe('encodeProtectedHeader / decodeProtectedHeader', () => {
  describe('byte-exact vectors', () => {
    it('encodes the minimal alg-3 header to the exact hand-derived bytes', () => {
      const bytes = encodeProtectedHeader(MINIMAL_ALG3)
      assert.deepStrictEqual(bytes, hexToBytes(MINIMAL_PROTECTED_HEADER_HEX))
    })

    it('encodes a chunked header carrying plaintext_length to the exact hand-derived bytes', () => {
      // { 1: -65793, 5: <7-byte base nonce>, 16: typ, -1: 4096, -65789: 10000 },
      // RFC 8949 canonical order (keys sorted by their own encoded bytes, so
      // the two 1-byte keys come first, then the 4-byte negatives):
      //
      //   a5                     map, 5 pairs
      //   01 3a 00010100         1 (alg) => -65793  (negint, n = 65792)
      //   05 47 00…06            5 (iv) => 7-byte bstr (0x40 | 7 = 0x47)
      //   10 78 28 6170706c…     16 (typ) => 40-byte tstr
      //   20 19 1000             -1 (chunk_size) => 4096 (uint16)
      //   3a 000100fc 19 2710    -65789 (plaintext_length) => 10000 (uint16)
      //
      // The label is 0x3a-prefixed because -65789 needs the 4-byte negint
      // form: n = 65789 - 1 = 65788 = 0x000100fc.
      const expected =
        'a5013a000101000547000102030405061078286170706c69636174696f6e2f766e642e66696c65636f696e2d' +
        '656e6372797074696f6e2b636f7365201910003a000100fc192710'
      const bytes = encodeProtectedHeader({
        alg: ALG_CHUNKED_AES_256_GCM_STREAM,
        iv: FIXTURE_BASE_NONCE_7,
        chunkSize: MIN_CHUNK_SIZE,
        plaintextLength: 10000,
      })
      assert.deepStrictEqual(bytes, hexToBytes(expected))
    })
  })

  describe('determinism', () => {
    it("is insensitive to the input object's own key order (map keys are sorted, not inserted verbatim)", () => {
      const fields: ProtectedHeaderFields = {
        alg: ALG_CHUNKED_AES_256_GCM_STREAM,
        iv: FIXTURE_BASE_NONCE_7,
        chunkSize: MIN_CHUNK_SIZE,
        appMetadata: { a: 1, b: 2 },
      }
      const reordered: ProtectedHeaderFields = {
        appMetadata: { b: 2, a: 1 },
        chunkSize: MIN_CHUNK_SIZE,
        alg: ALG_CHUNKED_AES_256_GCM_STREAM,
        iv: FIXTURE_BASE_NONCE_7,
      }
      assert.deepStrictEqual(encodeProtectedHeader(fields), encodeProtectedHeader(reordered))
    })
  })

  describe('round trip', () => {
    it('round-trips the minimal alg-3 header', () => {
      const bytes = encodeProtectedHeader(MINIMAL_ALG3)
      const decoded = decodeProtectedHeader(bytes)
      assert.deepStrictEqual(decoded, { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, bytes })
    })

    it('round-trips the minimal chunked header', () => {
      const bytes = encodeProtectedHeader(MINIMAL_CHUNKED)
      const decoded = decodeProtectedHeader(bytes)
      assert.deepStrictEqual(decoded, {
        alg: ALG_CHUNKED_AES_256_GCM_STREAM,
        iv: FIXTURE_BASE_NONCE_7,
        chunkSize: MIN_CHUNK_SIZE,
        bytes,
      })
    })

    it('round-trips every optional field together', () => {
      const fields: ProtectedHeaderFields = {
        alg: ALG_CHUNKED_AES_256_GCM_STREAM,
        iv: FIXTURE_BASE_NONCE_7,
        contentType: 'video/mp4',
        chunkSize: 65536,
        plaintextLength: 42 * 65536,
        appMetadata: { category: 'videos', size: 1024, tags: ['a', 'b'] },
      }
      const bytes = encodeProtectedHeader(fields)
      const decoded = decodeProtectedHeader(bytes)
      assert.deepStrictEqual(decoded, { ...fields, appMetadata: toNullProto(fields.appMetadata ?? {}), bytes })
    })

    it('round-trips a numeric content_type (uint form)', () => {
      const fields: ProtectedHeaderFields = { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, contentType: 42 }
      const decoded = decodeProtectedHeader(encodeProtectedHeader(fields))
      assert.strictEqual(decoded.contentType, 42)
    })

    it('omits optional fields from the decoded result when absent, rather than defaulting them', () => {
      const decoded = decodeProtectedHeader(encodeProtectedHeader(MINIMAL_ALG3))
      assert.strictEqual('contentType' in decoded, false)
      assert.strictEqual('chunkSize' in decoded, false)
      assert.strictEqual('plaintextLength' in decoded, false)
      assert.strictEqual('appMetadata' in decoded, false)
    })
  })

  describe('every field is read exactly once', () => {
    it('encodes the IV it validated, even when the field is a getter answering differently each read', () => {
      // The accessor problem one level up from app_metadata: `fields` is the
      // caller's object, and validating `fields.iv` then encoding
      // `fields.iv` is two observable reads. Rejecting accessors here would
      // be wrong — an options object with a getter is ordinary JavaScript —
      // so the encoder reads each field once instead.
      let reads = 0
      const bytes = encodeProtectedHeader({
        alg: ALG_AES_256_GCM,
        get iv() {
          reads++
          return reads === 1 ? FIXTURE_IV_12 : Uint8Array.from([1, 2, 3])
        },
      })
      assert.strictEqual(reads, 1)
      // The decisive assertion: what landed on the wire is what passed
      // validation, so this package's own decoder accepts its own output.
      assert.deepStrictEqual(Array.from(decodeProtectedHeader(bytes).iv), Array.from(FIXTURE_IV_12))
    })

    it('encodes the app_metadata it validated, not a second reading of the same field', () => {
      let reads = 0
      const bytes = encodeProtectedHeader({
        alg: ALG_AES_256_GCM,
        iv: FIXTURE_IV_12,
        get appMetadata() {
          reads++
          return reads === 1 ? { n: 1 } : { n: 1.5 }
        },
      })
      assert.strictEqual(reads, 1)
      assert.deepStrictEqual(decodeProtectedHeader(bytes).appMetadata, toNullProto({ n: 1 }))
    })
  })

  describe('protected bytes are preserved verbatim', () => {
    it('returns the exact input bytes, not a re-encode, even when their key order differs from what this package would produce', () => {
      // typ (16) before alg (1) — our own encoder always sorts 1 before 16
      // (RFC 8949 canonical order), so if decode re-encoded before
      // returning `bytes`, this assertion would see them reordered.
      const raw = Uint8Array.from([0xa3, ...TYP_ENTRY, ...IV_ENTRY, ...ALG3_ENTRY])
      const decoded = decodeProtectedHeader(raw)
      assert.deepStrictEqual(decoded.bytes, raw)
      assert.notDeepStrictEqual(decoded.bytes, hexToBytes(MINIMAL_PROTECTED_HEADER_HEX))
      assert.strictEqual(decoded.alg, ALG_AES_256_GCM)
    })
  })

  describe('rejection paths', () => {
    it('rejects a protected header that is not a CBOR map', () => {
      // A bare CBOR array (0x80, empty) instead of a map.
      assert.throws(() => decodeProtectedHeader(Uint8Array.from([0x80])), MalformedEnvelopeError)
    })

    it('rejects trailing bytes after the map (protected must be exactly one CBOR value)', () => {
      const trailing = Uint8Array.from([...encodeProtectedHeader(MINIMAL_ALG3), 0x00])
      assert.throws(() => decodeProtectedHeader(trailing), MalformedEnvelopeError)
    })

    it('rejects a duplicate map key instead of last-write-wins', () => {
      // { 1: 3, 1: 3 } — declares 2 entries, both key 1.
      const raw = Uint8Array.from([0xa2, 0x01, 0x03, 0x01, 0x03])
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects a non-minimal ("upcast") integer encoding', () => {
      // alg (1) -> 3, but 3 is encoded as a 2-byte uint8 form (0x18 0x03)
      // instead of the 1-byte compact form (0x03).
      const raw = Uint8Array.from([0xa2, 0x01, 0x18, 0x03, ...TYP_ENTRY])
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects a missing alg', () => {
      const raw = Uint8Array.from([0xa1, ...TYP_ENTRY])
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects an unknown alg, naming the value', () => {
      const raw = Uint8Array.from([0xa2, 0x01, 0x05, ...TYP_ENTRY])
      assert.throws(
        () => decodeProtectedHeader(raw),
        (err: unknown) => err instanceof UnsupportedSchemeError && /\b5\b/.test(err.message)
      )
    })

    it('rejects a missing typ', () => {
      const raw = Uint8Array.from([0xa1, ...ALG3_ENTRY])
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects the wrong typ value', () => {
      const wrongTyp = utf8Bytes('application/vnd.foc-envelope+cose') // go-fee's typ, not ours
      const raw = Uint8Array.from([0xa2, ...ALG3_ENTRY, 0x10, 0x78, wrongTyp.length, ...wrongTyp])
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects a header label that is not an integer or a text string (a bare boolean) in the protected header', () => {
      // { ..., true: 1 } — label `true` (0xf5), value 1 (0x01).
      const raw = buildProtectedHeader(1, 0xf5, 0x01)
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects Partial IV (label 6) in the protected header', () => {
      // { ..., 6: h'010203' }
      const raw = buildProtectedHeader(1, 0x06, 0x43, 0x01, 0x02, 0x03)
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects crit (label 2) present in the protected header, naming the offending labels', () => {
      // { ..., 2: [100] } — crit lists one label (100) this profile does not understand.
      const raw = buildProtectedHeader(1, 0x02, 0x81, 0x18, 0x64)
      assert.throws(
        () => decodeProtectedHeader(raw),
        (err: unknown) => err instanceof CriticalHeaderError && /\b100\b/.test(err.message)
      )
    })

    it('rejects crit present but not an array', () => {
      // { ..., 2: 5 } — crit must be an array, not a bare integer.
      const raw = buildProtectedHeader(1, 0x02, 0x05)
      assert.throws(() => decodeProtectedHeader(raw), CriticalHeaderError)
    })

    it('rejects crit as an empty array', () => {
      // { ..., 2: [] } — RFC 9052 requires a *nonempty* array of labels.
      const raw = buildProtectedHeader(1, 0x02, 0x80)
      assert.throws(() => decodeProtectedHeader(raw), CriticalHeaderError)
    })

    it('rejects a label appearing in both the protected and unprotected maps', () => {
      // content_type (label 3) in both buckets. decodeEnvelope always passes
      // the real unprotected map in as the second argument (see decode.ts) —
      // this exercises that path directly. Label 3 rather than the iv,
      // because label 5 in the unprotected map is separately forbidden, so
      // it would not prove the overlap rule fired. See cose-decode.test.ts
      // for the full-envelope version of this scenario.
      const protectedBytes = buildProtectedHeader(1, 0x03, 0x69, ...utf8Bytes('video/mp4'))
      const unprotectedMap = new Map([[3, 'text/plain']])
      assert.throws(() => decodeProtectedHeader(protectedBytes, unprotectedMap), MalformedEnvelopeError)
    })

    it('rejects alg encoded as a CBOR float (3.0), even though it numerically equals the integer form', () => {
      // { 1: <float64 3.0>, 16: typ }. After decoding, JS cannot tell
      // integer 3 and float 3.0 apart (both are the number `3`), so the
      // fix must reject the float encoding before that point is reached.
      const floatAlgEntry = [0x01, 0xfb, 0x40, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
      const raw = Uint8Array.from([0xa2, ...floatAlgEntry, ...TYP_ENTRY])
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects content_type encoded as CBOR undefined instead of treating it as absent', () => {
      // { ..., 3: undefined } — 0xf7 is CBOR's `undefined` simple value.
      // `Map.get` returns `undefined` both when a key is absent and when
      // its value is JS `undefined`, so this key being genuinely *present*
      // must not collapse into the same case as the field being absent.
      const raw = buildProtectedHeader(1, 0x03, 0xf7)
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects invalid UTF-8 in content_type instead of silently replacing it with U+FFFD', () => {
      // tstr of length 1 containing 0xFF, not a valid UTF-8 sequence on its
      // own. cborg's default TextDecoder is lenient (replaces with U+FFFD);
      // this profile re-validates strictly instead.
      const raw = buildProtectedHeader(1, 0x03, 0x61, 0xff)
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('round-trips valid multi-byte UTF-8 in content_type (the strict revalidation does not reject legitimate text)', () => {
      const fields: ProtectedHeaderFields = {
        alg: ALG_AES_256_GCM,
        iv: FIXTURE_IV_12,
        contentType: 'héllo wörld 日本語',
      }
      const decoded = decodeProtectedHeader(encodeProtectedHeader(fields))
      assert.strictEqual(decoded.contentType, 'héllo wörld 日本語')
    })

    it('rejects an app_metadata value outside the safe integer range instead of decoding it to bigint', () => {
      // app_metadata -> { "big": 18446744073709551615 } (2^64 - 1), which
      // cborg would otherwise decode as a `bigint` — a value `CborValue`
      // does not include.
      const raw = buildProtectedHeader(
        1,
        ...APP_METADATA_KEY_BYTES,
        0xa1, // app_metadata: map, 1 entry
        0x63,
        ...utf8Bytes('big'), // key: "big"
        0x1b,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff,
        0xff // uint64 max
      )
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects an app_metadata value encoded as CBOR undefined', () => {
      // app_metadata -> { "x": undefined } (0xf7) — a value `CborValue` does
      // not include, and which would otherwise decode successfully.
      const raw = buildProtectedHeader(
        1,
        ...APP_METADATA_KEY_BYTES,
        0xa1, // app_metadata: map, 1 entry
        0x61,
        ...utf8Bytes('x'), // key: "x"
        0xf7 // value: undefined
      )
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects chunk_size present when alg is 3 (whole-object AES-256-GCM)', () => {
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, chunkSize: MIN_CHUNK_SIZE }),
        MalformedEnvelopeError
      )
    })

    it('rejects chunk_size missing when alg is the chunked scheme', () => {
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_CHUNKED_AES_256_GCM_STREAM, iv: FIXTURE_BASE_NONCE_7 }),
        MalformedEnvelopeError
      )
    })

    it('rejects chunk_size out of range', () => {
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_CHUNKED_AES_256_GCM_STREAM,
            iv: FIXTURE_BASE_NONCE_7,
            chunkSize: MIN_CHUNK_SIZE - 1,
          }),
        MalformedEnvelopeError
      )
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_CHUNKED_AES_256_GCM_STREAM,
            iv: FIXTURE_BASE_NONCE_7,
            chunkSize: MAX_CHUNK_SIZE + 1,
          }),
        MalformedEnvelopeError
      )
    })

    it('rejects plaintext_length present when alg is 3', () => {
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, plaintextLength: 1 }),
        MalformedEnvelopeError
      )
    })

    it('accepts a zero plaintext_length: an empty object is one tag-only chunk', () => {
      const bytes = encodeProtectedHeader({
        alg: ALG_CHUNKED_AES_256_GCM_STREAM,
        iv: FIXTURE_BASE_NONCE_7,
        chunkSize: MIN_CHUNK_SIZE,
        plaintextLength: 0,
      })
      assert.strictEqual(decodeProtectedHeader(bytes).plaintextLength, 0)
    })

    it('rejects a negative or non-integer plaintext_length', () => {
      for (const plaintextLength of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
        assert.throws(
          () =>
            encodeProtectedHeader({
              alg: ALG_CHUNKED_AES_256_GCM_STREAM,
              iv: FIXTURE_BASE_NONCE_7,
              chunkSize: MIN_CHUNK_SIZE,
              plaintextLength,
            }),
          MalformedEnvelopeError
        )
      }
    })

    it("rejects a plaintext_length describing a layout past this library's limits", () => {
      // At every legal chunk size the 64 GiB object ceiling binds before the
      // wire chunk-count limit (see chunk-layout.test.ts), so this is the
      // object limit talking. The header is refused rather than written and
      // left for a decoder to discover.
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_CHUNKED_AES_256_GCM_STREAM,
            iv: FIXTURE_BASE_NONCE_7,
            chunkSize: MIN_CHUNK_SIZE,
            plaintextLength: MAX_ENCODED_OBJECT_SIZE,
          }),
        MalformedEnvelopeError
      )
    })

    it('rejects a content_type that is neither a string nor a non-negative integer', () => {
      // 0xf4 = CBOR `false`, a legal CBOR value but not a valid content_type.
      const raw = buildProtectedHeader(1, 0x03, 0xf4)
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects app_metadata that is not a map', () => {
      // -65792 => an empty array (0x80) instead of a map.
      const raw = buildProtectedHeader(1, ...APP_METADATA_KEY_BYTES, 0x80)
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects a nested app_metadata Map key that is a boolean, null, or float on encode', () => {
      // Moved from decode to encode: decode preserves received bytes
      // verbatim and never re-sorts them, so a key's sort order only
      // matters to the side that actually sorts — this package's own
      // encoder (RFC 8949 canonical map-key order). See headers.ts's
      // assertNoUnsortableMapKeys doc and the corresponding lenient-decode
      // test above.
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: new Map([[true, 1]]) },
          }),
        MalformedEnvelopeError
      )
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: new Map([[null, 1]]) },
          }),
        MalformedEnvelopeError
      )
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: new Map([[1.5, 1]]) },
          }),
        MalformedEnvelopeError
      )
    })

    it('rejects an unsortable Map key nested inside a plain object inside app_metadata', () => {
      // appMetadata itself, and any plain-object nesting inside it, is a
      // caller-supplied Record — encode must recurse into plain objects too
      // (not just Map), since app_metadata's CborValue union allows both.
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: { inner: new Map([[true, 1]]) } },
          }),
        MalformedEnvelopeError
      )
    })

    it('rejects an app_metadata key that is not a string', () => {
      // app_metadata -> { 1: "x" } — key 1 is an int, not a tstr.
      const raw = buildProtectedHeader(1, ...APP_METADATA_KEY_BYTES, 0xa1, 0x01, 0x61, 0x78)
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects a nested app_metadata map key that is a boolean on decode too (scalar-keys-only, both sides)', () => {
      // Previously lenient on decode: the old assertNoDuplicateByteStringKeys
      // only ever inspected Uint8Array keys, so a boolean key sailed through
      // unexamined. The shared assertValidAppMetadata now runs the same
      // scalar-key policy on both sides (defect 4) — app_metadata ->
      // { "outer": { true: 1 } }, hand-built since a boolean-keyed map
      // cannot be expressed through the encode-side Record<string, unknown> API.
      const raw = buildProtectedHeader(
        1,
        ...APP_METADATA_KEY_BYTES,
        0xa1, // app_metadata: map, 1 entry
        0x65,
        ...utf8Bytes('outer'), // key: "outer"
        0xa1, // nested map, 1 entry
        0xf5, // key: true
        0x01 // value: 1
      )
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects an array used as a nested app_metadata map key, on both encode and decode', () => {
      // "Two structurally-equal array keys are treated as distinct" (defect
      // 4) is eliminated by construction: arrays are no longer a legal key
      // shape at all, on either side.
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: new Map([[[1], 'value']]) },
          }),
        MalformedEnvelopeError
      )
      // app_metadata -> { "outer": { [1]: "value" } }, hand-built: an array
      // key cannot be expressed through the encode-side API either.
      const raw = buildProtectedHeader(
        1,
        ...APP_METADATA_KEY_BYTES,
        0xa1, // app_metadata: map, 1 entry
        0x65,
        ...utf8Bytes('outer'), // key: "outer"
        0xa1, // nested map, 1 entry
        0x81,
        0x01, // key: [1]
        0x65,
        ...utf8Bytes('value') // value: "value"
      )
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects a map used as a nested app_metadata map key, on both encode and decode', () => {
      // "Duplicate byte-string keys inside a map that is itself used as
      // another map's key escape checking entirely" (defect 4) is closed
      // the same way: a map is never a legal key, so the escape hatch no
      // longer exists, regardless of what that inner map would have
      // contained.
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: new Map([[new Map(), 'value']]) },
          }),
        MalformedEnvelopeError
      )
      // app_metadata -> { "outer": { {}: "value" } }, hand-built.
      const raw = buildProtectedHeader(
        1,
        ...APP_METADATA_KEY_BYTES,
        0xa1, // app_metadata: map, 1 entry
        0x65,
        ...utf8Bytes('outer'), // key: "outer"
        0xa1, // nested map, 1 entry
        0xa0, // key: {} (empty map)
        0x65,
        ...utf8Bytes('value') // value: "value"
      )
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('rejects two byte-equal Uint8Array keys in a caller-built Map on ENCODE, not just decode', () => {
      // The old assertNoUnsortableMapKeys (encode-only) never checked for
      // duplicate byte-string keys at all — only assertNoDuplicateByteStringKeys
      // (decode-only) did (defect 4). Two distinct Uint8Array instances
      // holding identical bytes are different keys to a JS Map (identity,
      // not content), so nothing previously stopped the encoder from
      // emitting a protected header with two colliding byte-string keys.
      const duplicateKeyMap = new Map<CborValue, CborValue>([
        [Uint8Array.from([1, 2, 3]), 'a'],
        [Uint8Array.from([1, 2, 3]), 'b'],
      ])
      assert.throws(
        () =>
          encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { outer: duplicateKeyMap } }),
        MalformedEnvelopeError
      )
    })

    it('rejects two identical byte-string keys in a nested app_metadata map', () => {
      // A JS Map compares Uint8Array keys by identity, so cborg's own
      // rejectDuplicateMapKeys (which calls Map.has()) cannot see two
      // byte-equal-but-distinct-instance keys — both would otherwise be
      // silently retained. app_metadata -> { "outer": { h'010203': "a",
      // h'010203': "b" } }.
      const raw = buildProtectedHeader(
        1,
        ...APP_METADATA_KEY_BYTES,
        0xa1, // app_metadata: map, 1 entry
        0x65,
        ...utf8Bytes('outer'), // key: "outer"
        0xa2, // nested map, 2 entries
        0x43,
        0x01,
        0x02,
        0x03, // key: h'010203'
        0x61,
        0x61, // value: "a"
        0x43,
        0x01,
        0x02,
        0x03, // key: h'010203' again
        0x61,
        0x62 // value: "b"
      )
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })

    it('decodes an app_metadata key of "__proto__" as an own property without polluting the prototype', () => {
      // `{ __proto__: ... }` as an object-literal key sets the prototype
      // instead of creating a property, so the computed-key form is the
      // only way to put a genuine own "__proto__" property into the input.
      const fields: ProtectedHeaderFields = {
        alg: ALG_AES_256_GCM,
        iv: FIXTURE_IV_12,
        appMetadata: { ['__proto__']: 'not-a-prototype' },
      }
      const decoded = decodeProtectedHeader(encodeProtectedHeader(fields))
      const appMetadata = decoded.appMetadata ?? {}
      assert.strictEqual(Object.getPrototypeOf(appMetadata), null)
      assert.strictEqual(Object.hasOwn(appMetadata, '__proto__'), true)
      assert.strictEqual(Object.getOwnPropertyDescriptor(appMetadata, '__proto__')?.value, 'not-a-prototype')
      assert.strictEqual(Object.getPrototypeOf({}), Object.prototype) // sanity: global Object.prototype is unharmed
    })
  })
})

/**
 * `app_metadata` is opaque application data, so what this package permits
 * inside it is a deliberate library policy rather than anything COSE or
 * FIP-1253 requires. These groups are the policy:
 *
 * - permitted value shapes (an allowlist — everything unnamed is refused)
 * - permitted numbers (safe integers only)
 * - string well-formedness (no lone surrogates; a BOM is content, not framing)
 * - structural limits (nesting depth, cycles)
 * - the rejection messages themselves
 *
 * Several of these encode a bug this package actually shipped, and the
 * comments inside say which. The groupings are by behaviour so that a
 * reader looking for "what may go in app_metadata" finds it in one place.
 */
describe('app_metadata', () => {
  describe('permitted numbers: safe integers only (a library restriction, not a COSE rule)', () => {
    it('rejects a fractional number at encode, rather than emitting bytes its own decoder refuses', () => {
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { value: 1.5 } }),
        MalformedEnvelopeError
      )
    })

    it('rejects NaN, Infinity, -Infinity, and -0 as top-level app_metadata values', () => {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
        assert.throws(
          () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { value } }),
          MalformedEnvelopeError,
          `expected ${String(value)} to be rejected`
        )
      }
    })

    it('rejects -0 specifically (Number.isSafeInteger(-0) is true, and -0 === 0, so only Object.is tells them apart)', () => {
      assert.strictEqual(Number.isSafeInteger(-0), true) // -0 passes the integer check alone
      assert.strictEqual(Object.is(-0, 0), false) // -0 and 0 are distinct only via Object.is
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { value: -0 } }),
        MalformedEnvelopeError
      )
      // 0 itself remains perfectly valid.
      assert.doesNotThrow(() =>
        encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { value: 0 } })
      )
    })

    it('rejects an unsupported number nested inside an array, a plain object, and a Map alike', () => {
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { list: [1, 2, 1.5] } }),
        MalformedEnvelopeError
      )
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: { inner: Number.NaN } },
          }),
        MalformedEnvelopeError
      )
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: new Map<CborValue, CborValue>([['k', Number.POSITIVE_INFINITY]]) },
          }),
        MalformedEnvelopeError
      )
    })

    it('rejects an unsupported number used as a nested Map key, not just as a value', () => {
      // "recursively reject unsupported numeric values ... descending into
      // nested plain objects, arrays, and Maps (values and keys alike)."
      assert.throws(
        () =>
          encodeProtectedHeader({
            alg: ALG_AES_256_GCM,
            iv: FIXTURE_IV_12,
            appMetadata: { outer: new Map([[1.5, 'value']]) },
          }),
        MalformedEnvelopeError
      )
    })

    it('accepts safe integers across the full range, including the safe-integer bounds and negative values', () => {
      const fields: ProtectedHeaderFields = {
        alg: ALG_AES_256_GCM,
        iv: FIXTURE_IV_12,
        appMetadata: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, zero: 0, negative: -42 },
      }
      const decoded = decodeProtectedHeader(encodeProtectedHeader(fields))
      assert.deepStrictEqual(decoded.appMetadata, toNullProto(fields.appMetadata ?? {}))
    })

    it('still rejects a float-encoded whole number at decode (e.g. float16 3.0) — the tokenizer is unchanged', () => {
      // app_metadata -> { "n": <float16 3.0> } (f9 4200). This is banned by
      // createStrictTokenizer regardless of app_metadata's numeric policy —
      // the fix for defect 1 is encode-side; the existing decode-side float
      // ban must not be relaxed.
      const raw = buildProtectedHeader(
        1,
        ...APP_METADATA_KEY_BYTES,
        0xa1, // app_metadata: map, 1 entry
        0x61,
        ...utf8Bytes('n'), // key: "n"
        0xf9,
        0x42,
        0x00 // value: float16 3.0
      )
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })
  })

  describe('strings: a byte-order mark is content, and is preserved rather than stripped', () => {
    const BOM = '\uFEFF'

    it('round-trips a metadata value with a leading U+FEFF byte-order mark byte-identically', () => {
      const withBom = `${BOM}hello`
      const fields: ProtectedHeaderFields = { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { note: withBom } }
      const decoded = decodeProtectedHeader(encodeProtectedHeader(fields))
      const note = decoded.appMetadata?.note
      assert.strictEqual(note, withBom)
      assert.strictEqual(typeof note === 'string' && note.codePointAt(0), 0xfeff)
    })

    it('preserves a leading U+FEFF in a metadata KEY, without colliding with the unprefixed key', () => {
      const bomKey = `${BOM}key`
      const fields: ProtectedHeaderFields = {
        alg: ALG_AES_256_GCM,
        iv: FIXTURE_IV_12,
        appMetadata: { [bomKey]: 'a', key: 'b' },
      }
      const decoded = decodeProtectedHeader(encodeProtectedHeader(fields))
      const appMetadata = decoded.appMetadata ?? {}
      assert.strictEqual(appMetadata[bomKey], 'a')
      assert.strictEqual(appMetadata.key, 'b')
      assert.strictEqual(Object.keys(appMetadata).length, 2)
    })

    it('rejects typ carrying a leading U+FEFF: it must no longer compare equal to ENVELOPE_TYPE', () => {
      // Before the fix, cborg's lenient TextDecoder (ignoreBOM: false) would
      // silently strip the BOM, making this typ value compare equal to
      // ENVELOPE_TYPE — a silent data modification. After the fix, the BOM
      // is preserved, so the comparison against ENVELOPE_TYPE correctly fails.
      const bomTyp = utf8Bytes(`${BOM}${ENVELOPE_TYPE}`)
      const raw = Uint8Array.from([0xa2, ...ALG3_ENTRY, 0x10, 0x78, bomTyp.length, ...bomTyp])
      assert.throws(() => decodeProtectedHeader(raw), MalformedEnvelopeError)
    })
  })

  // The four defects below all trace to one root cause: assertValidAppMetadata
  // used to be a denylist (hunt for specific bad shapes, let everything else
  // through). It is now an allowlist (name every permitted shape, reject
  // everything else by default) — see headers.ts's assertAllowlistedValue.
  // These tests exercise that allowlist directly at the encode boundary,
  // since every one of these repros is "encode accepted it, decode did not."

  describe('permitted value shapes: everything not on the allowlist is refused', () => {
    it('rejects a sparse array (an index hole, not an undefined written to the slot)', () => {
      const sparse = new Array(3)
      sparse[0] = 'a'
      sparse[2] = 'c'
      // sparse[1] is a hole, not `undefined` written to the slot.
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { x: sparse } }),
        (error: unknown) => error instanceof MalformedEnvelopeError && error.message.includes('app_metadata.x[1]')
      )
    })

    it('rejects a symbol-keyed property rather than silently dropping it', () => {
      // Object.entries skips symbol keys, so before this check the entry was
      // neither validated nor encoded: it vanished between the caller's
      // object and the wire with nothing raised on either side. A symbol
      // *value* was already refused; only keys were escaping.
      const withSymbolKey = { visible: 'v', [Symbol('hidden')]: 'h' } as unknown as Record<string, CborValue>
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: withSymbolKey }),
        MalformedEnvelopeError
      )
    })

    it('rejects a symbol key nested inside a plain object, not just at the root', () => {
      const nested = { outer: { visible: 'v', [Symbol('hidden')]: 'h' } } as unknown as Record<string, CborValue>
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: nested }),
        MalformedEnvelopeError
      )
    })

    it('rejects a non-enumerable string-keyed property rather than silently dropping it', () => {
      // Same failure mode as a symbol key: Object.entries cannot see it, so
      // neither the validator nor the encoder ever visits it.
      const withHidden: Record<string, CborValue> = { visible: 'v' }
      Object.defineProperty(withHidden, 'hidden', { value: 'h', enumerable: false })
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: withHidden }),
        MalformedEnvelopeError
      )
    })

    it('rejects an enumerable getter before reading it during validation', () => {
      // Validation and encoding are separate passes. A getter could return a
      // valid integer first and a forbidden float second, making the encoder
      // emit bytes its own decoder rejects. Reject accessors without invoking
      // them, so metadata is a stable data value rather than executable code.
      let reads = 0
      const withGetter: Record<string, CborValue> = {}
      Object.defineProperty(withGetter, 'value', {
        enumerable: true,
        get() {
          reads++
          return reads === 1 ? 1 : 1.5
        },
      })

      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: withGetter }),
        MalformedEnvelopeError
      )
      assert.strictEqual(reads, 0)
    })

    it('rejects an accessor-backed array element before reading it', () => {
      const values: CborValue[] = [1]
      let reads = 0
      Object.defineProperty(values, 0, {
        enumerable: true,
        configurable: true,
        get() {
          reads++
          return 1
        },
      })

      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { values } }),
        MalformedEnvelopeError
      )
      assert.strictEqual(reads, 0)
    })

    it('rejects extra own properties on an array, Map or byte string', () => {
      // CBOR encodes none of these, so `[1, 2]` with `.extra` set arrives as
      // `[1, 2]` and the property is gone — the same silent omission as a
      // symbol or non-enumerable key on a plain object.
      const array: CborValue[] = [1, 2]
      ;(array as unknown as Record<string, string>).extra = 'lost'
      const map = new Map<CborValue, CborValue>([['k', 1]])
      ;(map as unknown as Record<string, string>).extra = 'lost'
      const bytes = Uint8Array.from([1, 2])
      ;(bytes as unknown as Record<string, string>).extra = 'lost'

      for (const [label, value] of [
        ['array', array],
        ['Map', map],
        ['byte string', bytes],
      ] as Array<[string, CborValue]>) {
        assert.throws(
          () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { value } }),
          MalformedEnvelopeError,
          `for ${label}`
        )
      }
    })

    it('rejects digit-only properties that are not actual container elements', () => {
      // A digit-only name is not automatically an element. 2^32 - 1 is
      // outside JavaScript's array-index range, and a very large decimal name
      // is an ordinary property on a byte string. CBOR ignores both.
      const array: CborValue[] = [1]
      ;(array as unknown as Record<string, string>)['4294967295'] = 'lost'
      const bytes = Uint8Array.from([1])
      ;(bytes as unknown as Record<string, string>)['999999999999999999999999'] = 'lost'

      for (const [label, value] of [
        ['array', array],
        ['byte string', bytes],
      ] as Array<[string, CborValue]>) {
        assert.throws(
          () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { value } }),
          MalformedEnvelopeError,
          `for ${label}`
        )
      }
    })

    it('still accepts ordinary arrays, Maps and byte strings', () => {
      // The checks above must not reject the normal shapes.
      assert.doesNotThrow(() =>
        encodeProtectedHeader({
          alg: ALG_AES_256_GCM,
          iv: FIXTURE_IV_12,
          appMetadata: { a: [1, 2], m: new Map<CborValue, CborValue>([['k', 1]]), b: Uint8Array.from([1, 2]) },
        })
      )
    })

    it('rejects undefined as an app_metadata value', () => {
      const appMetadata = { x: undefined } as unknown as Record<string, CborValue>
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata }),
        (error: unknown) => error instanceof MalformedEnvelopeError && error.message.includes('app_metadata.x')
      )
    })

    it('rejects a bigint as an app_metadata value', () => {
      const appMetadata = { x: 9007199254740993n } as unknown as Record<string, CborValue>
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata }),
        (error: unknown) =>
          error instanceof MalformedEnvelopeError &&
          error.message.includes('app_metadata.x') &&
          error.message.includes('bigint')
      )
    })
  })

  describe('strings: a lone surrogate is refused at encode, never silently replaced', () => {
    it('rejects a lone surrogate as a value, rather than letting it round-trip as U+FFFD', () => {
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { x: '\uD800' } }),
        (error: unknown) => error instanceof MalformedEnvelopeError && error.message.includes('app_metadata.x')
      )
    })

    it('rejects a lone surrogate as an app_metadata KEY, before two distinct keys can collide into one', () => {
      // '\uD800' and '\uD801' are both lone high surrogates. Both would
      // encode (via cborg's lenient TextEncoder) to the same replacement
      // character '�' — two distinct source keys becoming one on the
      // wire — so this must be caught before any bytes are produced.
      const appMetadata: Record<string, CborValue> = { '\uD800': 'a', '\uD801': 'b' }
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata }),
        MalformedEnvelopeError
      )
    })
  })

  describe('structural limits: nesting depth and cycles', () => {
    it('rejects nesting past MAX_APP_METADATA_DEPTH with a package error, not a raw RangeError', () => {
      let deep: unknown[] = []
      for (let i = 0; i < MAX_APP_METADATA_DEPTH + 10; i++) {
        deep = [deep]
      }
      const appMetadata = { x: deep } as unknown as Record<string, CborValue>
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata }),
        MalformedEnvelopeError // NOT RangeError — a raw stack overflow would escape as one instead.
      )
    })

    it('rejects a cyclic array with a package error, not a raw RangeError', () => {
      const cyclic: unknown[] = []
      cyclic.push(cyclic)
      const appMetadata = { x: cyclic } as unknown as Record<string, CborValue>
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata }),
        MalformedEnvelopeError
      )
    })

    it('rejects a cyclic Map, not just a cyclic array', () => {
      const cyclic = new Map<CborValue, CborValue>()
      cyclic.set('self', cyclic)
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { x: cyclic } }),
        MalformedEnvelopeError
      )
    })
  })

  describe('rejection messages name the offending path and type', () => {
    it('names the array index and the constructor name for a rejected class instance', () => {
      const appMetadata = { x: [1, 2, new Date()] } as unknown as Record<string, CborValue>
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata }),
        (error: unknown) =>
          error instanceof MalformedEnvelopeError &&
          error.message.includes('app_metadata.x[2]') &&
          error.message.includes('Date')
      )
    })

    it('names a nested plain-object path for a rejected symbol value', () => {
      const appMetadata = { outer: { inner: Symbol('s') } } as unknown as Record<string, CborValue>
      assert.throws(
        () => encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata }),
        (error: unknown) =>
          error instanceof MalformedEnvelopeError &&
          error.message.includes('app_metadata.outer.inner') &&
          error.message.includes('symbol')
      )
    })

    it('still accepts every previously-valid shape (allowlist is not stricter than the old checks for valid input)', () => {
      // "nested" is a Map (not a plain object) so this compares directly
      // against the input: a nested CBOR map always decodes back to a `Map`
      // (useMaps: true reaches every depth), regardless of which shape —
      // plain object or Map — the caller used to build it before encoding.
      const fields: ProtectedHeaderFields = {
        alg: ALG_AES_256_GCM,
        iv: FIXTURE_IV_12,
        appMetadata: {
          category: 'videos',
          size: 1024,
          tags: ['a', 'b'],
          nested: new Map<CborValue, CborValue>([['deeper', new Map<CborValue, CborValue>([['k', [1, 2, 3]]])]]),
          flag: true,
          empty: null,
          blob: Uint8Array.from([1, 2, 3]),
        },
      }
      const decoded = decodeProtectedHeader(encodeProtectedHeader(fields))
      const decodedMeta = decoded.appMetadata ?? {}
      const expectedMeta = fields.appMetadata ?? {}
      // Compared by content, not by exact constructor: cborg's writer can
      // hand back a byte-string view whose runtime class is Node's `Buffer`
      // rather than a bare `Uint8Array` for some encoded sizes (an internal
      // chunk-reuse optimization inside cborg, unrelated to this package's
      // own encode/decode logic) — `deepStrictEqual` treats that as a
      // different type even though the bytes are identical, so this checks
      // the bytes rather than the class.
      assert.deepStrictEqual(Array.from(decodedMeta.blob as Uint8Array), [1, 2, 3])
      const decodedRest = { ...decodedMeta }
      const expectedRest = { ...expectedMeta }
      delete decodedRest.blob
      delete expectedRest.blob
      assert.deepStrictEqual(decodedRest, expectedRest)
    })
  })
})

describe('crit (label 2): accepted when every listed label is understood and present', () => {
  it('accepts crit listing typ (16): understood by this profile and always present', () => {
    const raw = buildProtectedHeader(1, 0x02, 0x81, 0x10) // crit: [16]
    assert.doesNotThrow(() => decodeProtectedHeader(raw))
  })

  it('accepts crit listing iv (5): protected in this profile, so understood and always present', () => {
    // Before the IV moved into the protected header it was neither, and a
    // crit naming it was rejected.
    const raw = buildProtectedHeader(1, 0x02, 0x81, 0x05) // crit: [5]
    assert.doesNotThrow(() => decodeProtectedHeader(raw))
  })

  it('accepts crit listing both alg (1) and typ (16): both understood and both present', () => {
    const raw = buildProtectedHeader(1, 0x02, 0x82, 0x01, 0x10) // crit: [1, 16]
    assert.doesNotThrow(() => decodeProtectedHeader(raw))
  })

  it('accepts crit listing chunk_size (-1) for the chunked scheme, when chunk_size is actually present', () => {
    // Hand-built chunked-scheme header: { 1: -65793, 5: base nonce, 16: typ, -1: 4096, 2: [-1] }.
    const raw = Uint8Array.from([
      0xa5, // map, 5 entries
      0x01,
      0x3a,
      0x00,
      0x01,
      0x01,
      0x00, // alg: -65793 (4-byte negint form; n = 65793 - 1 = 65792 = 0x00010100)
      0x05,
      0x47,
      ...FIXTURE_BASE_NONCE_7, // iv: 7-byte base nonce (0x40 | 7 = 0x47)
      ...TYP_ENTRY,
      0x20, // key: -1 (chunk_size)
      0x19,
      0x10,
      0x00, // value: 4096 (uint16 form)
      0x02,
      0x81,
      0x20, // crit: [-1]
    ])
    const decoded = decodeProtectedHeader(raw)
    assert.strictEqual(decoded.alg, ALG_CHUNKED_AES_256_GCM_STREAM)
    assert.strictEqual(decoded.chunkSize, MIN_CHUNK_SIZE)
  })

  it('rejects crit listing chunk_size (-1) on an alg-3 header, where chunk_size is never present', () => {
    // { 1: 3, 16: typ, 2: [-1] } — chunk_size is a label this profile
    // understands in principle, but it is forbidden (never present) when
    // alg is the whole-object scheme, so condition (b) fails.
    const raw = buildProtectedHeader(1, 0x02, 0x81, 0x20) // crit: [-1]
    assert.throws(
      () => decodeProtectedHeader(raw),
      (err: unknown) => err instanceof CriticalHeaderError && /-1/.test(err.message)
    )
  })

  it('rejects crit that lists itself (label 2): RFC 9052 §3.1 recommends omitting it, and this profile does not understand it', () => {
    // { ..., 2: [2] }. RFC 9052 §3.1 does not forbid a crit self-reference
    // outright — it places integer labels 0-7 (which includes label 2) in
    // its "SHOULD be omitted" bucket, not a MUST-NOT-include rule — but
    // this profile's fixed understood-label set (see headers.ts,
    // UNDERSTOOD_CRIT_LABELS) deliberately excludes label 2, so a
    // self-referential crit is rejected as "not understood."
    const raw = buildProtectedHeader(1, 0x02, 0x81, 0x02) // crit: [2]
    assert.throws(
      () => decodeProtectedHeader(raw),
      (err: unknown) => err instanceof CriticalHeaderError && /\b2\b/.test(err.message)
    )
  })

  it('still rejects crit naming a label this profile has never heard of, naming it in the error', () => {
    // Regression guard: the pre-existing "unsupported label" test still
    // holds under the new conditional logic.
    const raw = buildProtectedHeader(1, 0x02, 0x81, 0x18, 0x64) // crit: [100]
    assert.throws(
      () => decodeProtectedHeader(raw),
      (err: unknown) => err instanceof CriticalHeaderError && /\b100\b/.test(err.message)
    )
  })
})

describe('encodeUnprotectedHeader / decodeUnprotectedHeader', () => {
  it('encodes an empty map: v1 defines no content unprotected parameters', () => {
    assert.deepStrictEqual(encodeUnprotectedHeader(), new Map())
  })

  it("returns a fresh map each call, so a caller cannot mutate a previous envelope's header", () => {
    const first = encodeUnprotectedHeader()
    first.set(100, 'scribbled on')
    assert.strictEqual(encodeUnprotectedHeader().size, 0)
  })

  it('accepts the empty map the encoder writes', () => {
    assert.deepStrictEqual(decodeUnprotectedHeader(new Map()), new Map())
  })

  it('accepts an unknown non-critical parameter and hands it back unchanged', () => {
    // The extension policy: decoders accept what they do not recognize here,
    // rather than rejecting an envelope written against a later profile.
    const incoming = new Map<CborValue, CborValue>([[100, 'from a future profile']])
    assert.deepStrictEqual(decodeUnprotectedHeader(incoming), incoming)
  })

  it('rejects a value that is not a CBOR map', () => {
    assert.throws(() => decodeUnprotectedHeader('not-a-map'), MalformedEnvelopeError)
  })

  it('rejects iv (label 5) here: this profile requires it protected, inside the AAD', () => {
    assert.throws(() => decodeUnprotectedHeader(new Map([[5, FIXTURE_IV_12]])), MalformedEnvelopeError)
    assert.throws(() => decodeUnprotectedHeader(new Map([[5, FIXTURE_BASE_NONCE_7]])), MalformedEnvelopeError)
  })

  it('rejects a header label that is not an integer or a text string (a bare boolean) in the unprotected header', () => {
    assert.throws(() => decodeUnprotectedHeader(new Map<CborValue, CborValue>([[true, 1]])), MalformedEnvelopeError)
  })

  it('rejects Partial IV (label 6) in the unprotected header', () => {
    assert.throws(
      () => decodeUnprotectedHeader(new Map<CborValue, CborValue>([[6, Uint8Array.from([1, 2, 3])]])),
      MalformedEnvelopeError
    )
  })

  it('rejects crit (label 2) present in the unprotected header, even when well-formed', () => {
    // RFC 9052 requires crit to be protected; its presence anywhere in the
    // unprotected header is rejected regardless of whether its own array
    // content would otherwise be well-formed.
    assert.throws(() => decodeUnprotectedHeader(new Map<CborValue, CborValue>([[2, [100]]])), CriticalHeaderError)
  })
})
