import assert from 'node:assert'
import { ALG_AES_256_GCM, ALG_CHUNKED_AES_256_GCM_STREAM, MAX_CHUNK_SIZE, MIN_CHUNK_SIZE } from '../src/constants.ts'
import {
  ALG_A256KW,
  MAX_APP_METADATA_DEPTH,
  MAX_ENVELOPE_SIZE,
  TAG_ENCRYPT,
  TAG_ENCRYPT0,
} from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import type { EncodeEnvelopeInput, RecipientInput } from '../src/cose/encode.ts'
import { encodeEnvelope, prepareEnvelope } from '../src/cose/encode.ts'
import type { CborValue } from '../src/cose/headers.ts'
import { MalformedEnvelopeError } from '../src/errors.ts'
import {
  FIXTURE_BASE_NONCE_7,
  FIXTURE_IV_12,
  hexToBytes,
  MINIMAL_ENVELOPE_TAG16_HEX,
  MINIMAL_PROTECTED_HEADER_HEX,
  toNullProto,
} from './cose-fixtures.ts'

const MINIMAL_INPUT: EncodeEnvelopeInput = {
  protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 },
}

/**
 * A256KW recipient per RFC 9052 §8.5.2 and FIP amendment 1: the recipient
 * protected field MUST be a zero-length byte string (`h''`, not the encoded
 * empty map `h'a0'`), with `alg` and the recommended `kid` in the
 * unprotected map instead. `[h'', {1: -5, 4: key_identifier}, wrapped_cek]`
 * in the amendment's own notation.
 */
const A256KW_RECIPIENT: RecipientInput = {
  protectedBytes: new Uint8Array(0),
  unprotected: new Map<number, CborValue>([
    [1, ALG_A256KW],
    [4, Uint8Array.from([0xaa, 0xbb])], // kid
  ]),
  ciphertext: Uint8Array.from([9, 9, 9, 9]),
}

/**
 * ECDH-ES+A256KW recipient per FIP amendment 1: unlike A256KW, `alg` MUST
 * appear in the recipient protected map (its bytes feed `COSE_KDF_Context`)
 * and MUST NOT appear in the unprotected map.
 */
const ECDH_ES_A256KW_RECIPIENT: RecipientInput = {
  protectedBytes: hexToBytes('a101381e'), // { 1: -31 } — alg: -31 needs the 1-byte-follows form (n=30 >= 24)
  unprotected: new Map(),
  ciphertext: Uint8Array.from([2, 2, 2, 2]),
}

describe('encodeEnvelope', () => {
  describe('byte-exact vectors', () => {
    it('encodes a minimal envelope with no recipients as tag 16 (COSE_Encrypt0)', () => {
      // D0 (tag 16) 83 (array/3) <protected bstr> A0 (empty unprotected map) F6 (ciphertext: null)
      assert.deepStrictEqual(encodeEnvelope(MINIMAL_INPUT), hexToBytes(MINIMAL_ENVELOPE_TAG16_HEX))
    })

    it('encodes an envelope with one A256KW recipient as tag 96 (COSE_Encrypt)', () => {
      assert.strictEqual(A256KW_RECIPIENT.protectedBytes.length, 0)

      // D8 60 (tag 96, needs a 1-byte-follows form since 96 >= 24)
      // 84 (array/4) 58 3C <60-byte protected bstr> A0 (empty unprotected)
      // F6 (ciphertext: null) 81 (recipients: array/1)
      // 83 (recipient tuple/3) 40 (protected: h'', zero-length)
      // A2 01 24 04 42 AABB (unprotected: {1: -5, 4: h'aabb'})
      // 44 09090909 (ciphertext)
      const expected = hexToBytes(`d86084583c${MINIMAL_PROTECTED_HEADER_HEX}a0f6818340a201240442aabb4409090909`)
      assert.deepStrictEqual(encodeEnvelope({ ...MINIMAL_INPUT, recipients: [A256KW_RECIPIENT] }), expected)
    })

    it('retains the exact protected bytes placed in either envelope type', () => {
      for (const input of [MINIMAL_INPUT, { ...MINIMAL_INPUT, recipients: [A256KW_RECIPIENT] }]) {
        const prepared = prepareEnvelope(input)
        const decoded = decodeEnvelope(prepared.bytes)

        assert.strictEqual(prepared.tag, decoded.tag)
        assert.deepStrictEqual(prepared.protectedBytes, decoded.protectedHeader.bytes)
        assert.deepStrictEqual(prepared.bytes, encodeEnvelope(input))
      }
    })
  })

  describe('tag selection', () => {
    it('selects tag 16 when recipients is omitted', () => {
      assert.strictEqual(encodeEnvelope(MINIMAL_INPUT)[0], 0xd0)
    })

    it('rejects an explicitly empty recipients array rather than reading it as tag 16', () => {
      // Omitting the field and passing [] express different intents; quietly
      // treating the second as the first would hide the caller's mistake.
      assert.throws(() => encodeEnvelope({ ...MINIMAL_INPUT, recipients: [] }), MalformedEnvelopeError)
    })

    it('selects tag 96 when recipients is non-empty', () => {
      const bytes = encodeEnvelope({ ...MINIMAL_INPUT, recipients: [A256KW_RECIPIENT] })
      assert.strictEqual(bytes[0], 0xd8)
      assert.strictEqual(bytes[1], 0x60)
    })
  })

  describe('encoder enforces what the decoder requires', () => {
    it('rejects an iv length that does not match the scheme', () => {
      // alg 3 (whole-object) requires a 12-byte iv; a 7-byte one (the
      // chunked scheme's base-nonce length) previously encoded successfully
      // and only failed on decode.
      assert.throws(
        () =>
          encodeEnvelope({
            protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_BASE_NONCE_7 },
          }),
        MalformedEnvelopeError
      )
      // And the reverse: the chunked scheme requires a 7-byte base nonce.
      assert.throws(
        () =>
          encodeEnvelope({
            protectedHeader: {
              alg: ALG_CHUNKED_AES_256_GCM_STREAM,
              iv: FIXTURE_IV_12,
              chunkSize: MIN_CHUNK_SIZE,
            },
          }),
        MalformedEnvelopeError
      )
    })

    it('enforces the 1 MiB envelope decode ceiling at encode time too', () => {
      // app_metadata large enough that the encoded envelope alone (before
      // any ciphertext) exceeds MAX_ENVELOPE_SIZE. Previously this encoded
      // "successfully" into bytes decodeEnvelope would then refuse to read
      // back (see cose-decode.test.ts's own ceiling test, decode-side).
      const oversizedValue = 'x'.repeat(MAX_ENVELOPE_SIZE + 1024)
      assert.throws(
        () =>
          encodeEnvelope({
            protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { big: oversizedValue } },
          }),
        MalformedEnvelopeError
      )
    })

    it('rejects a recipient ciphertext that is not a byte string, rather than emitting an unreadable envelope', () => {
      // The CDDL's third recipient element is a bstr and decodeEnvelope's
      // tuple schema enforces it, but the types are erased at runtime and
      // this package ships JavaScript. Before this check the encoder
      // accepted a string here and produced bytes its own decoder refused.
      const recipient = {
        protectedBytes: new Uint8Array(0),
        unprotected: new Map<number, CborValue>([[1, ALG_A256KW]]),
        ciphertext: 'not bytes',
      } as unknown as RecipientInput
      assert.throws(() => encodeEnvelope({ ...MINIMAL_INPUT, recipients: [recipient] }), MalformedEnvelopeError)
    })

    it('rejects a recipient whose protected field or unprotected map is the wrong runtime type', () => {
      const badProtected = {
        protectedBytes: 'not bytes',
        unprotected: new Map<number, CborValue>([[1, ALG_A256KW]]),
        ciphertext: Uint8Array.from([9]),
      } as unknown as RecipientInput
      assert.throws(() => encodeEnvelope({ ...MINIMAL_INPUT, recipients: [badProtected] }), MalformedEnvelopeError)

      const badUnprotected = {
        protectedBytes: new Uint8Array(0),
        unprotected: { 1: ALG_A256KW },
        ciphertext: Uint8Array.from([9]),
      } as unknown as RecipientInput
      assert.throws(() => encodeEnvelope({ ...MINIMAL_INPUT, recipients: [badUnprotected] }), MalformedEnvelopeError)
    })

    it('accepts a text-string header label in a recipient unprotected map, as the CDDL permits', () => {
      // RFC 9052 §3.1 labels are `int / tstr`. Every label this profile
      // defines is an integer, but an application extension may use a text
      // one, and the type must not forbid what the validator accepts.
      const recipient: RecipientInput = {
        protectedBytes: new Uint8Array(0),
        unprotected: new Map<number | string, CborValue>([
          [1, ALG_A256KW],
          ['x-app-hint', 'anything'],
        ]),
        ciphertext: Uint8Array.from([9, 9, 9, 9]),
      }
      const decoded = decodeEnvelope(encodeEnvelope({ ...MINIMAL_INPUT, recipients: [recipient] }))
      assert.strictEqual(decoded.recipients[0].unprotected.get('x-app-hint'), 'anything')
    })

    it('rejects a sparse recipients array instead of encoding the hole as CBOR undefined', () => {
      // `.map` skips holes, so a sparse array used to pass every check here
      // and then encode `f7` — bytes decodeEnvelope rejects.
      const sparse = new Array(1) as RecipientInput[]
      assert.throws(() => encodeEnvelope({ ...MINIMAL_INPUT, recipients: sparse }), MalformedEnvelopeError)

      // Built by assignment, not as an array literal with an empty slot:
      // Biome bans the literal form, and its autofix writes an explicit
      // `undefined` — which `.map` *does* visit, so the fixed test would no
      // longer detect the regression it exists for.
      const holeAfterEntry = new Array<RecipientInput>(3)
      holeAfterEntry[0] = A256KW_RECIPIENT
      holeAfterEntry[2] = A256KW_RECIPIENT
      assert.throws(() => encodeEnvelope({ ...MINIMAL_INPUT, recipients: holeAfterEntry }), MalformedEnvelopeError)
    })

    it('reports ordinary bad calls as package errors, not raw TypeErrors', () => {
      // errors.ts promises that catching EnvelopeError catches everything
      // this package throws, so the argument checks have to come before the
      // first property access.
      const badCalls: Array<() => unknown> = [
        () => encodeEnvelope(null as unknown as EncodeEnvelopeInput),
        () => encodeEnvelope({} as unknown as EncodeEnvelopeInput),
        () => encodeEnvelope({ ...MINIMAL_INPUT, recipients: 'nope' as unknown as RecipientInput[] }),
        () => encodeEnvelope({ ...MINIMAL_INPUT, recipients: [null as unknown as RecipientInput] }),
      ]
      for (const call of badCalls) {
        assert.throws(call, MalformedEnvelopeError)
      }
    })

    it('rejects a float in a recipient unprotected map, instead of emitting bytes the decoder tokenizer bans', () => {
      // A256KW recipient carrying an unprotected extension value of 1.5.
      // Recipient crypto and protectedBytes content stay opaque; only the
      // encoder refusing to emit a structure its own decoder rejects is in
      // scope here.
      const recipientWithFloat: RecipientInput = {
        protectedBytes: new Uint8Array(0),
        unprotected: new Map<number, CborValue>([
          [1, ALG_A256KW],
          [100, 1.5],
        ]),
        ciphertext: Uint8Array.from([9, 9, 9, 9]),
      }
      assert.throws(
        () => encodeEnvelope({ ...MINIMAL_INPUT, recipients: [recipientWithFloat] }),
        MalformedEnvelopeError
      )
    })
  })

  describe('depth budgets: the encoder refuses exactly what the decoder would reject', () => {
    // Testing a depth comfortably past the limit (MAX_APP_METADATA_DEPTH +
    // 10, say) cannot tell a correct encoder/decoder depth budget apart from
    // one that is off by a couple of levels — which is why the boundary is
    // pinned exactly here. That exact mismatch is a defect this package has already
    // shipped once (see headers.ts's module doc: "255 nested arrays...
    // encode into an envelope that would not decode"), because the encoder
    // walks a bare JS value starting from zero while the decoder's tokenizer
    // counts nesting from the first byte of the wire, which already has a
    // few containers open by the time it reaches the same value. A boundary
    // test pins the exact edge instead of a comfortably-clear-of-it depth,
    // so a regression in either ENCLOSING_DEPTH constant is caught here
    // instead of only manifesting as "envelope encoded, decode rejects it"
    // somewhere downstream.
    //
    // Boundaries below were established empirically (encode + decode against
    // the real MAX_APP_METADATA_DEPTH, not hand-derived) and hardcoded here,
    // the same way the CBOR byte-exact vectors elsewhere in this suite are
    // derived once and then pinned as literals.
    function nestedArray(depth: number): CborValue[] {
      let value: CborValue[] = []
      for (let i = 0; i < depth; i++) {
        value = [value]
      }
      return value
    }

    it('accepts app_metadata nested exactly to the decoder-matching limit and rejects one level deeper', () => {
      const lastAccepted = nestedArray(253)
      const bytes = encodeEnvelope({
        protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { x: lastAccepted } },
      })
      const decoded = decodeEnvelope(bytes)
      assert.deepStrictEqual(decoded.protectedHeader.appMetadata, toNullProto({ x: lastAccepted }))

      const firstRejected = nestedArray(254)
      assert.throws(
        () =>
          encodeEnvelope({
            protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { x: firstRejected } },
          }),
        MalformedEnvelopeError
      )
    })

    it('accepts a recipient unprotected value nested exactly to the decoder-matching limit and rejects one level deeper', () => {
      const buildRecipient = (value: CborValue): RecipientInput => ({
        protectedBytes: new Uint8Array(0),
        unprotected: new Map<number, CborValue>([
          [1, ALG_A256KW],
          [100, value],
        ]),
        ciphertext: Uint8Array.from([9, 9, 9, 9]),
      })

      const lastAccepted = nestedArray(250)
      const bytes = encodeEnvelope({ ...MINIMAL_INPUT, recipients: [buildRecipient(lastAccepted)] })
      const decoded = decodeEnvelope(bytes)
      assert.deepStrictEqual(decoded.recipients[0].unprotected.get(100), lastAccepted)

      const firstRejected = nestedArray(251)
      assert.throws(
        () => encodeEnvelope({ ...MINIMAL_INPUT, recipients: [buildRecipient(firstRejected)] }),
        MalformedEnvelopeError
      )
    })
  })

  describe('round-trip property: anything encodeEnvelope accepts, decodeEnvelope accepts', () => {
    const CONTENT_TYPES: Array<string | number | undefined> = [undefined, 'application/octet-stream', 42]
    const APP_METADATA_VARIANTS: Array<Record<string, CborValue> | undefined> = [
      undefined,
      {},
      { category: 'videos', size: 1024, tags: ['a', 'b'] },
      { nested: new Map<CborValue, CborValue>([['k', 1]]) },
      { ['__proto__']: 'not-a-prototype' },
    ]
    // `undefined`, not `[]`, for the no-recipients case: an empty array is
    // rejected outright, so it has no place in a round-trip property.
    const RECIPIENT_SETS: Array<RecipientInput[] | undefined> = [
      undefined,
      [A256KW_RECIPIENT],
      [A256KW_RECIPIENT, ECDH_ES_A256KW_RECIPIENT],
    ]

    it('holds for alg 3 (whole-object) across content types, app_metadata shapes, and recipient sets', () => {
      // Not just "decode does not throw": a decoder that silently dropped or
      // corrupted a field (the historical lone-surrogate-to-U+FFFD class of
      // bug) would still pass a not-thrown check, so every decoded field is
      // compared back against what was actually encoded.
      for (const contentType of CONTENT_TYPES) {
        for (const appMetadata of APP_METADATA_VARIANTS) {
          for (const recipients of RECIPIENT_SETS) {
            const input: EncodeEnvelopeInput = {
              protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, contentType, appMetadata },
              recipients,
            }
            const bytes = encodeEnvelope(input)
            const decoded = decodeEnvelope(bytes)
            assert.strictEqual(decoded.tag, recipients === undefined ? TAG_ENCRYPT0 : TAG_ENCRYPT)
            assert.strictEqual(decoded.protectedHeader.alg, ALG_AES_256_GCM)
            assert.strictEqual(decoded.protectedHeader.contentType, contentType)
            assert.deepStrictEqual(
              decoded.protectedHeader.appMetadata,
              appMetadata === undefined ? undefined : toNullProto(appMetadata)
            )
            // Array.from, not deepStrictEqual on the typed arrays directly:
            // cborg can hand back a byte-string view whose runtime class is
            // Node's Buffer rather than a bare Uint8Array for some encoded
            // sizes (see the same note in cose-headers.test.ts), which
            // deepStrictEqual treats as a type mismatch despite identical
            // bytes.
            assert.deepStrictEqual(Array.from(decoded.protectedHeader.iv), Array.from(FIXTURE_IV_12))
            assert.strictEqual(decoded.recipients.length, recipients?.length ?? 0)
          }
        }
      }
    })

    it('holds for the chunked scheme across chunk sizes, plaintext lengths, and content types', () => {
      for (const chunkSize of [MIN_CHUNK_SIZE, 65536, MAX_CHUNK_SIZE]) {
        for (const chunks of [undefined, 1, 42]) {
          for (const contentType of CONTENT_TYPES) {
            const input: EncodeEnvelopeInput = {
              protectedHeader: {
                alg: ALG_CHUNKED_AES_256_GCM_STREAM,
                iv: FIXTURE_BASE_NONCE_7,
                chunkSize,
                plaintextLength: chunks === undefined ? undefined : chunks * chunkSize,
                contentType,
              },
            }
            const bytes = encodeEnvelope(input)
            const decoded = decodeEnvelope(bytes)
            assert.strictEqual(decoded.protectedHeader.alg, ALG_CHUNKED_AES_256_GCM_STREAM)
            assert.strictEqual(decoded.protectedHeader.chunkSize, chunkSize)
            assert.strictEqual(
              decoded.protectedHeader.plaintextLength,
              chunks === undefined ? undefined : chunks * chunkSize
            )
            assert.strictEqual(decoded.protectedHeader.contentType, contentType)
            assert.deepStrictEqual(Array.from(decoded.protectedHeader.iv), Array.from(FIXTURE_BASE_NONCE_7))
          }
        }
      }
    })
  })

  describe('round-trip property: hostile and edge-shaped metadata is either refused at encode or survives intact', () => {
    // The round-trip property above loops a fixed list of combinations the
    // encoder and decoder already agreed on, so it missed all four defects.
    // These app_metadata values are chosen specifically to exercise the
    // edges where encode and decode used to disagree — non-integer numbers,
    // duplicate-by-content or compound-shaped keys, unsupported primitives
    // (sparse arrays, undefined, bigint), malformed strings that used to be
    // silently corrupted instead of rejected, and pathological nesting
    // (cycles, past-the-depth-limit structures). For every candidate,
    // either encode must reject it outright, or decode must accept exactly
    // what encode produced — checked by comparing the decoded value back
    // against the input, not just by not-throwing, so a candidate that
    // decodes "successfully" into something OTHER than what was encoded
    // (silent corruption, e.g. the lone-surrogate case) fails this test
    // instead of passing as a successful round trip.
    function duplicateByteKeyMap(): Map<CborValue, CborValue> {
      // Two distinct Uint8Array instances holding the same bytes: a JS Map
      // treats them as separate keys (identity, not content).
      return new Map<CborValue, CborValue>([
        [Uint8Array.from([1, 2, 3]), 'a'],
        [Uint8Array.from([1, 2, 3]), 'b'],
      ])
    }

    /** A hole at index 1, not a written `undefined` — `new Array(n)` needs no cast to reach `CborValue[]`. */
    function sparseArrayCandidate(): unknown[] {
      const array = new Array(3)
      array[0] = 'a'
      array[2] = 'c'
      return array
    }

    function cyclicArrayCandidate(): unknown[] {
      const cyclic: unknown[] = []
      cyclic.push(cyclic)
      return cyclic
    }

    function pastDepthLimitCandidate(): unknown[] {
      let deep: unknown[] = []
      for (let i = 0; i < MAX_APP_METADATA_DEPTH + 10; i++) {
        deep = [deep]
      }
      return deep
    }

    // Deliberately `Record<string, unknown>`, not `Record<string, CborValue>`
    // — several entries below are exactly the shapes CborValue excludes,
    // reached through `unknown` rather than a `CborValue`-widening cast.
    const APP_METADATA_CANDIDATES: Array<Record<string, unknown>> = [
      { n: 1 },
      { n: -1 },
      { n: 0 },
      { n: -0 },
      { n: Number.MAX_SAFE_INTEGER },
      { n: Number.MIN_SAFE_INTEGER },
      { n: 1.5 },
      { n: Number.NaN },
      { n: Number.POSITIVE_INFINITY },
      { n: Number.NEGATIVE_INFINITY },
      { key: new Map<CborValue, CborValue>([[Uint8Array.from([9]), 'value']]) },
      { key: duplicateByteKeyMap() },
      { nested: { list: [1, 2, { deeper: new Map<CborValue, CborValue>([['x', [1, 2, 3]]]) }] } },
      { key: new Map<CborValue, CborValue>([[[1], 'array key']]) },
      { key: new Map<CborValue, CborValue>([[new Map(), 'map key']]) },
      { note: '\uFEFFhello' },
      // Defect 1: unsupported primitives that used to pass encode and fail decode.
      { x: sparseArrayCandidate() },
      { x: undefined },
      { x: 9007199254740993n },
      // Defect 2: malformed strings that used to silently corrupt (both as a value and as a key).
      { x: '\uD800' },
      { '\uD800': 'a', '\uD801': 'b' },
      // Never a permitted app_metadata shape, on either side.
      { x: new Date() },
      { x: Symbol('app_metadata_symbol_candidate') },
      // Defect 4: depth and cycle guards.
      { x: cyclicArrayCandidate() },
      { x: pastDepthLimitCandidate() },
    ]

    /**
     * `decodeAppMetadata` decodes every CBOR map to a `Map` (`useMaps: true`
     * reaches every depth), including one whose *input*, before encoding,
     * was a caller-supplied plain object — this profile's `CborValue` union
     * allows a plain object anywhere a `Map` is allowed, precisely so a
     * caller can write JSON-shaped config instead of building `Map`s by
     * hand (see headers.ts's module doc). This mirrors that one-way
     * conversion on the expected side of the comparison below, so the
     * equality check verifies real round-trip fidelity instead of failing
     * on "Map vs plain object" for a reason unconnected to any of the four
     * defects.
     */
    function toDecodedShape(value: unknown): unknown {
      if (Array.isArray(value)) {
        return value.map(toDecodedShape)
      }
      if (value instanceof Map) {
        const mapped = new Map<CborValue, CborValue>()
        for (const [key, entry] of value) {
          mapped.set(key, toDecodedShape(entry) as CborValue)
        }
        return mapped
      }
      if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
        const mapped = new Map<CborValue, CborValue>()
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          mapped.set(key, toDecodedShape(entry) as CborValue)
        }
        return mapped
      }
      return value
    }

    it('holds for every candidate: encode rejects it outright, or decode accepts exactly what encode produced', () => {
      for (const appMetadata of APP_METADATA_CANDIDATES) {
        let bytes: Uint8Array
        try {
          bytes = encodeEnvelope({
            protectedHeader: {
              alg: ALG_AES_256_GCM,
              iv: FIXTURE_IV_12,
              appMetadata: appMetadata as Record<string, CborValue>,
            },
          })
        } catch {
          continue // rejected before any bytes were produced — invariant trivially holds
        }
        const decoded = decodeEnvelope(bytes)
        const expected: Record<string, CborValue> = Object.create(null)
        for (const [key, value] of Object.entries(appMetadata)) {
          expected[key] = toDecodedShape(value) as CborValue
        }
        assert.deepStrictEqual(
          decoded.protectedHeader.appMetadata,
          expected,
          `decoded app_metadata did not equal what was encoded for candidate: ${Object.keys(appMetadata).join(', ')}`
        )
      }
    })

    it('sanity: at least one candidate is actually rejected at encode (the loop above is not vacuous)', () => {
      assert.throws(() =>
        encodeEnvelope({
          protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { n: 1.5 } },
        })
      )
      assert.throws(() =>
        encodeEnvelope({
          protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12, appMetadata: { key: duplicateByteKeyMap() } },
        })
      )
    })
  })
})
