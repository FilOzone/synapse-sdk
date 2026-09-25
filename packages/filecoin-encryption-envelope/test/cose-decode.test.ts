import assert from 'node:assert'
import { encode as cborEncode, rfc8949EncodeOptions, Tagged } from 'cborg'
import { ALG_AES_256_GCM, ALG_CHUNKED_AES_256_GCM_STREAM } from '../src/constants.ts'
import { ENVELOPE_TYPE, MAX_ENVELOPE_SIZE, TAG_ENCRYPT, TAG_ENCRYPT0 } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import type { EncodeEnvelopeInput, RecipientInput } from '../src/cose/encode.ts'
import { encodeEnvelope } from '../src/cose/encode.ts'
import type { CborValue } from '../src/cose/headers.ts'
import { CriticalHeaderError, MalformedEnvelopeError } from '../src/errors.ts'
import {
  concatBytes,
  FIXTURE_BASE_NONCE_7,
  FIXTURE_IV_12,
  hexToBytes,
  MINIMAL_ENVELOPE_TAG16_HEX,
  MINIMAL_PROTECTED_HEADER_HEX,
  toNullProto,
  utf8Bytes,
} from './cose-fixtures.ts'

const MINIMAL_INPUT: EncodeEnvelopeInput = {
  protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 },
}

// A256KW recipient per RFC 9052 §8.5.2 / FIP amendment 1: protected is a
// zero-length byte string (h''), and `alg` lives in the unprotected map
// alongside the recommended `kid`. Recipient *cryptography* is out of scope
// for this package; the header shape is not — see the structural-validation
// suite at the end of this file.
// A256KW's ciphertext must be exactly 40 bytes (a 32-byte CEK plus RFC
// 3394's 8-byte integrity block); this fixture's dummy wrapped key uses that
// length so it is a well-formed A256KW recipient wherever it is reused.
const RECIPIENT: RecipientInput = {
  protectedBytes: new Uint8Array(0),
  unprotected: new Map<number, CborValue>([
    [1, -5],
    [4, Uint8Array.from([0xaa, 0xbb])],
  ]),
  ciphertext: new Uint8Array(40).fill(9),
}

/**
 * Hand-build a tag-96 envelope carrying one recipient with the given
 * protected bytes and unprotected map. Built by hand rather than through
 * `encodeEnvelope`, because the encoder now applies the same recipient
 * rules — a test that went through it could only ever produce recipients
 * the decoder already accepts, which is the opposite of what these cases
 * need to prove. `ciphertext` defaults to a 40-byte dummy wrap so callers
 * exercising A256KW shapes get a well-formed one without asking for it.
 */
function envelopeWithRawRecipient(
  recipientProtected: Uint8Array,
  recipientUnprotected: Map<CborValue, CborValue>,
  ciphertext: Uint8Array = new Uint8Array(40).fill(9)
): Uint8Array {
  const protectedBytes = hexToBytes(MINIMAL_PROTECTED_HEADER_HEX)
  return cborEncode(
    new Tagged(TAG_ENCRYPT, [
      protectedBytes,
      new Map(),
      null,
      [[recipientProtected, recipientUnprotected, ciphertext]],
    ]),
    rfc8949EncodeOptions
  )
}

/** Two distinct JS keys that are the same CBOR byte-string key on the wire. */
function byteStringDuplicateMap(): Map<CborValue, CborValue> {
  return new Map<CborValue, CborValue>([
    [Uint8Array.from([1, 2]), 'first'],
    [Uint8Array.from([1, 2]), 'second'],
  ])
}

describe('COSE_recipient structural validation', () => {
  it('rejects byte-equal duplicate keys nested in a recipient protected parameter', () => {
    const recipientProtected = cborEncode(
      new Map<CborValue, CborValue>([
        [1, -31],
        [100, byteStringDuplicateMap()],
      ]),
      rfc8949EncodeOptions
    )
    assert.throws(() => decodeEnvelope(envelopeWithRawRecipient(recipientProtected, new Map())), MalformedEnvelopeError)
  })

  it('rejects byte-equal duplicate keys nested in a recipient unprotected parameter', () => {
    const recipientUnprotected = new Map<CborValue, CborValue>([
      [1, -5],
      [100, byteStringDuplicateMap()],
    ])
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(new Uint8Array(0), recipientUnprotected)),
      MalformedEnvelopeError
    )
  })

  it('rejects protected bytes that are not valid CBOR', () => {
    // h'ff' is the CBOR "break" byte: well-formed as a byte string on the
    // wire, not a decodable item inside it. Before recipient headers were
    // validated this decoded cleanly, so an attacker could park arbitrary
    // bytes in a field every reader was obliged to carry.
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(Uint8Array.from([0xff]), new Map([[1, -5]]))),
      MalformedEnvelopeError
    )
  })

  it('rejects protected bytes holding something other than a map', () => {
    // 0x80: an empty CBOR array. Valid CBOR, wrong shape for a header.
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(Uint8Array.from([0x80]), new Map([[1, -5]]))),
      MalformedEnvelopeError
    )
  })

  it('rejects A256KW with a non-empty protected field, including an encoded empty map', () => {
    // h'a0' is an *encoded empty map*, not a zero-length byte string — the
    // two differ by one byte and are routinely confused. RFC 9052 §3 and
    // this profile both require the latter for A256KW.
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(Uint8Array.from([0xa0]), new Map([[1, -5]]))),
      MalformedEnvelopeError
    )
  })

  it('rejects A256KW carrying alg in the protected map instead of the unprotected one', () => {
    const recipientProtected = cborEncode(new Map<CborValue, CborValue>([[1, -5]]), rfc8949EncodeOptions)
    assert.throws(() => decodeEnvelope(envelopeWithRawRecipient(recipientProtected, new Map())), MalformedEnvelopeError)
  })

  it('rejects a recipient that names no algorithm at all', () => {
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(new Uint8Array(0), new Map([[4, Uint8Array.from([1])]]))),
      MalformedEnvelopeError
    )
  })

  it('accepts a text algorithm identifier as a well-formed unsupported recipient', () => {
    const decoded = decodeEnvelope(envelopeWithRawRecipient(new Uint8Array(0), new Map([[1, 'custom-wrap']])))
    assert.strictEqual(decoded.recipients[0].alg, 'custom-wrap')
  })

  it('rejects a recipient algorithm identifier that is neither an integer nor a text string', () => {
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(new Uint8Array(0), new Map([[1, true]]))),
      MalformedEnvelopeError
    )
  })

  it("rejects a label present in both of a recipient's own header buckets", () => {
    const recipientProtected = cborEncode(
      new Map<CborValue, CborValue>([[4, Uint8Array.from([1])]]),
      rfc8949EncodeOptions
    )
    assert.throws(
      () =>
        decodeEnvelope(
          envelopeWithRawRecipient(
            recipientProtected,
            new Map<CborValue, CborValue>([
              [1, -5],
              [4, Uint8Array.from([2])],
            ])
          )
        ),
      MalformedEnvelopeError
    )
  })

  it('enforces the ECDH-ES+A256KW placement rule even though the algorithm is deferred', () => {
    // Deferring the cryptography does not make the header layout unknown:
    // these protected bytes feed COSE_KDF_Context, so alg must be inside
    // them (FIP amendment 1). Accepting the mirror shape would mean writing
    // objects the eventual implementation rejects.
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(new Uint8Array(0), new Map([[1, -31]]))),
      MalformedEnvelopeError
    )
  })

  it('accepts a well-formed recipient using an algorithm this version cannot unwrap', () => {
    // The profile says skip what you cannot use — but only once it is known
    // to be well formed. This is the shape the test above requires: alg in
    // the protected map, which is all of ECDH-ES+A256KW that is settled. Its
    // cryptographic profile is deferred; its header placement is not.
    const recipientProtected = cborEncode(new Map<CborValue, CborValue>([[1, -31]]), rfc8949EncodeOptions)
    const decoded = decodeEnvelope(envelopeWithRawRecipient(recipientProtected, new Map()))
    assert.strictEqual(decoded.recipients.length, 1)
  })

  it('rejects a kid (4) that is not a byte string, in either bucket', () => {
    // A text-string key identifier encodes and decodes without complaint
    // while meaning something different to every reader that compares it
    // against stored key material.
    assert.throws(
      () =>
        decodeEnvelope(
          envelopeWithRawRecipient(
            new Uint8Array(0),
            new Map<CborValue, CborValue>([
              [1, -5],
              [4, 'not-bytes'],
            ])
          )
        ),
      MalformedEnvelopeError
    )
    const kidInProtected = cborEncode(new Map<CborValue, CborValue>([[4, 'not-bytes']]), rfc8949EncodeOptions)
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(kidInProtected, new Map([[1, -31]]))),
      MalformedEnvelopeError
    )
  })

  it('rejects crit (2) in a recipient unprotected map, where RFC 9052 never allows it', () => {
    // Stricter still for A256KW: its protected field must be h'', so such a
    // recipient has nowhere valid to put a crit at all.
    assert.throws(
      () =>
        decodeEnvelope(
          envelopeWithRawRecipient(
            new Uint8Array(0),
            new Map<CborValue, CborValue>([
              [1, -5],
              [2, [1]],
            ])
          )
        ),
      CriticalHeaderError
    )
  })

  it('validates crit inside a recipient protected map, not only its absence from the unprotected one', () => {
    // An unsupported algorithm buys no latitude: a malformed recipient is
    // rejected rather than skipped, or "unsupported" becomes a way to carry
    // arbitrary critical parameters past every check.
    const withCrit = (crit: CborValue) =>
      cborEncode(
        new Map<CborValue, CborValue>([
          [1, -31],
          [2, crit],
        ]),
        rfc8949EncodeOptions
      )
    for (const [label, crit] of [
      ['an empty array', []],
      ['a non-array', 'bad'],
      ['a label this profile does not understand', [999]],
      ['a content label, meaningless in a recipient', [16]],
    ] as Array<[string, CborValue]>) {
      assert.throws(
        () => decodeEnvelope(envelopeWithRawRecipient(withCrit(crit), new Map())),
        CriticalHeaderError,
        `crit as ${label}`
      )
    }
  })

  it('accepts a recipient crit naming a label it understands and actually carries', () => {
    // crit marks a parameter critical, not unknown — a satisfiable listing
    // must be accepted, or the check is just a blanket rejection.
    const recipientProtected = cborEncode(
      new Map<CborValue, CborValue>([
        [1, -31],
        [2, [1]],
      ]),
      rfc8949EncodeOptions
    )
    const decoded = decodeEnvelope(envelopeWithRawRecipient(recipientProtected, new Map()))
    assert.strictEqual(decoded.recipients.length, 1)
  })

  it('accepts the canonical A256KW shape', () => {
    const decoded = decodeEnvelope(
      envelopeWithRawRecipient(
        new Uint8Array(0),
        new Map<CborValue, CborValue>([
          [1, -5],
          [4, Uint8Array.from([0xaa, 0xbb])],
        ])
      )
    )
    assert.strictEqual(decoded.recipients.length, 1)
    assert.strictEqual(decoded.recipients[0].protectedBytes.length, 0)
  })

  it('rejects an A256KW recipient ciphertext shorter than 40 bytes', () => {
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(new Uint8Array(0), new Map([[1, -5]]), new Uint8Array(39))),
      MalformedEnvelopeError
    )
  })

  it('rejects an A256KW recipient ciphertext longer than 40 bytes', () => {
    assert.throws(
      () => decodeEnvelope(envelopeWithRawRecipient(new Uint8Array(0), new Map([[1, -5]]), new Uint8Array(41))),
      MalformedEnvelopeError
    )
  })

  it('still decodes a non-A256KW recipient with a short ciphertext', () => {
    const decoded = decodeEnvelope(
      envelopeWithRawRecipient(new Uint8Array(0), new Map([[1, 'custom-wrap']]), new Uint8Array(2))
    )
    assert.strictEqual(decoded.recipients.length, 1)
    assert.strictEqual(decoded.recipients[0].ciphertext.length, 2)
  })
})

describe('decodeEnvelope', () => {
  describe('round trip', () => {
    it('round-trips a minimal tag-16 envelope', () => {
      const bytes = encodeEnvelope(MINIMAL_INPUT)
      const decoded = decodeEnvelope(bytes)
      assert.strictEqual(decoded.tag, TAG_ENCRYPT0)
      assert.strictEqual(decoded.protectedHeader.alg, ALG_AES_256_GCM)
      assert.deepStrictEqual(decoded.protectedHeader.iv, FIXTURE_IV_12)
      assert.strictEqual(decoded.unprotectedHeader.size, 0)
      assert.deepStrictEqual(decoded.recipients, [])
      assert.strictEqual(decoded.envelopeLength, bytes.length)
    })

    it('round-trips a tag-16 envelope with every optional protected-header field', () => {
      const input: EncodeEnvelopeInput = {
        protectedHeader: {
          alg: ALG_CHUNKED_AES_256_GCM_STREAM,
          iv: FIXTURE_BASE_NONCE_7,
          contentType: 'video/mp4',
          chunkSize: 65536,
          plaintextLength: 7 * 65536,
          appMetadata: { category: 'videos', size: 1024 },
        },
      }
      const bytes = encodeEnvelope(input)
      const decoded = decodeEnvelope(bytes)
      assert.strictEqual(decoded.tag, TAG_ENCRYPT0)
      assert.deepStrictEqual(decoded.protectedHeader, {
        ...input.protectedHeader,
        appMetadata: toNullProto(input.protectedHeader.appMetadata ?? {}),
        bytes: decoded.protectedHeader.bytes,
      })
      assert.deepStrictEqual(decoded.protectedHeader.iv, FIXTURE_BASE_NONCE_7)
      assert.strictEqual(decoded.unprotectedHeader.size, 0)
      assert.strictEqual(decoded.envelopeLength, bytes.length)
    })

    it('round-trips a tag-96 envelope with one recipient', () => {
      const bytes = encodeEnvelope({ ...MINIMAL_INPUT, recipients: [RECIPIENT] })
      const decoded = decodeEnvelope(bytes)
      assert.strictEqual(decoded.tag, TAG_ENCRYPT)
      assert.strictEqual(decoded.recipients.length, 1)
      assert.deepStrictEqual(decoded.recipients[0], {
        protectedBytes: RECIPIENT.protectedBytes,
        protected: new Map(),
        unprotected: RECIPIENT.unprotected,
        alg: -5,
        kid: RECIPIENT.unprotected.get(4),
        ciphertext: RECIPIENT.ciphertext,
      })
      assert.strictEqual(decoded.envelopeLength, bytes.length)
    })

    it('round-trips a tag-96 envelope with multiple heterogeneous recipients', () => {
      const secondRecipient: RecipientInput = {
        protectedBytes: hexToBytes('a101381e'), // alg: -31
        unprotected: new Map([[4, Uint8Array.from([1, 2])]]), // kid
        ciphertext: Uint8Array.from([7, 7]),
      }
      const bytes = encodeEnvelope({ ...MINIMAL_INPUT, recipients: [RECIPIENT, secondRecipient] })
      const decoded = decodeEnvelope(bytes)
      assert.strictEqual(decoded.recipients.length, 2)
      // Array.from, not deepStrictEqual on the Map directly: cborg can hand
      // back a byte-string view whose runtime class is Node's Buffer rather
      // than a bare Uint8Array for some encoded sizes (see the same note in
      // cose-headers.test.ts), which deepStrictEqual treats as a type
      // mismatch inside the Map's value despite identical bytes.
      assert.strictEqual(decoded.recipients[1].unprotected.size, secondRecipient.unprotected.size)
      assert.deepStrictEqual(
        Array.from(decoded.recipients[1].unprotected.get(4) as Uint8Array),
        Array.from(secondRecipient.unprotected.get(4) as Uint8Array)
      )
    })
  })

  describe('protected bytes are preserved verbatim', () => {
    it('decode returns the exact protected-header bytes sliced from the input, not a re-encode', () => {
      const bytes = encodeEnvelope(MINIMAL_INPUT)
      const decoded = decodeEnvelope(bytes)
      // Tag byte + array header occupy offsets 0-1; the protected bstr's own
      // 2-byte header (58 3c) occupies 2-3, so its 60 bytes of content start
      // at offset 4. See MINIMAL_ENVELOPE_TAG16_HEX for the derivation.
      const expectedProtectedBytes = bytes.subarray(4, 4 + 60)
      assert.deepStrictEqual(decoded.protectedHeader.bytes, expectedProtectedBytes)
    })

    it('preserves non-canonical protected-header bytes through the full envelope decode, not just decodeProtectedHeader in isolation', () => {
      // This package's own encoder always sorts `alg` (1) before `typ` (16)
      // (RFC 8949 canonical order), so a re-encode of the decoded map would
      // reproduce THIS package's canonical byte order regardless of what
      // order the wire actually used — which is exactly why the test above,
      // built only from this package's own canonical output, cannot tell a
      // verbatim slice apart from a re-encode: for a canonically-ordered
      // input, both produce identical bytes. Reordering `typ` before `alg`
      // here (a differently-shaped but still valid encoding of the same
      // profile) is the discriminating case: only a verbatim slice survives
      // it unchanged.
      const reorderedProtected = concatBytes(
        Uint8Array.from([0xa3, 0x10, 0x78, 0x28]),
        utf8Bytes(ENVELOPE_TYPE),
        Uint8Array.from([0x05, 0x4c]),
        FIXTURE_IV_12,
        Uint8Array.from([0x01, 0x03])
      )
      const bytes = concatBytes(
        Uint8Array.from([0xd0, 0x83, 0x58, reorderedProtected.length]),
        reorderedProtected,
        Uint8Array.from([0xa0, 0xf6])
      )
      const decoded = decodeEnvelope(bytes)
      assert.deepStrictEqual(decoded.protectedHeader.bytes, reorderedProtected)
      assert.notDeepStrictEqual(decoded.protectedHeader.bytes, hexToBytes(MINIMAL_PROTECTED_HEADER_HEX))
      assert.strictEqual(decoded.protectedHeader.alg, ALG_AES_256_GCM)
    })
  })

  describe('decodeFirst boundary', () => {
    it('decodes correctly when trailing ciphertext bytes follow the envelope, and leaves them untouched', () => {
      const envelope = encodeEnvelope(MINIMAL_INPUT)
      const ciphertext = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee])
      const blob = Uint8Array.from([...envelope, ...ciphertext])

      const decoded = decodeEnvelope(blob)
      assert.strictEqual(decoded.envelopeLength, envelope.length)
      assert.deepStrictEqual(blob.subarray(decoded.envelopeLength), ciphertext)
    })

    it('reports the correct envelopeLength for a tag-96 envelope followed by ciphertext', () => {
      const envelope = encodeEnvelope({ ...MINIMAL_INPUT, recipients: [RECIPIENT] })
      const ciphertext = Uint8Array.from([1, 2, 3])
      const blob = Uint8Array.from([...envelope, ...ciphertext])

      const decoded = decodeEnvelope(blob)
      assert.strictEqual(decoded.envelopeLength, envelope.length)
      assert.deepStrictEqual(blob.subarray(decoded.envelopeLength), ciphertext)
    })
  })

  describe('rejection paths', () => {
    it('reports non-Uint8Array input as a package error, not a raw TypeError', () => {
      // `data.length` and `data.subarray` were read before any guard, so a
      // string long enough to pass the first comparison threw TypeError —
      // which errors.ts promises this package never surfaces.
      for (const notBytes of [null, undefined, 'x'.repeat(MAX_ENVELOPE_SIZE + 1), 42]) {
        assert.throws(
          // @ts-expect-error deliberately passing a non-Uint8Array from untyped JS
          () => decodeEnvelope(notBytes),
          MalformedEnvelopeError,
          `for ${typeof notBytes}`
        )
      }
    })

    it('rejects byte-equal duplicate keys in a nested unknown unprotected parameter', () => {
      // cborg's duplicate-key rejection compares by JavaScript identity, so
      // two Uint8Arrays holding the same bytes are distinct keys to it and
      // both survive. Amendment 5 says duplicates are rejected throughout the
      // envelope, and the allowlist walk compares by content.
      const bytes = cborEncode(
        new Tagged(TAG_ENCRYPT0, [
          hexToBytes(MINIMAL_PROTECTED_HEADER_HEX),
          new Map([[100, byteStringDuplicateMap()]]),
          null,
        ]),
        rfc8949EncodeOptions
      )
      assert.throws(() => decodeEnvelope(bytes), MalformedEnvelopeError)
    })

    it('rejects byte-equal duplicate keys nested in an unknown protected parameter', () => {
      const protectedBytes = cborEncode(
        new Map<CborValue, CborValue>([
          [1, ALG_AES_256_GCM],
          [5, FIXTURE_IV_12],
          [16, ENVELOPE_TYPE],
          [100, byteStringDuplicateMap()],
        ]),
        rfc8949EncodeOptions
      )
      const bytes = cborEncode(new Tagged(TAG_ENCRYPT0, [protectedBytes, new Map(), null]), rfc8949EncodeOptions)
      assert.throws(() => decodeEnvelope(bytes), MalformedEnvelopeError)
    })

    it('rejects a compound key nested in an unknown parameter', () => {
      const nested = new Map<CborValue, CborValue>([[[1], 'value']])
      const bytes = cborEncode(
        new Tagged(TAG_ENCRYPT0, [hexToBytes(MINIMAL_PROTECTED_HEADER_HEX), new Map([[100, nested]]), null]),
        rfc8949EncodeOptions
      )
      assert.throws(() => decodeEnvelope(bytes), MalformedEnvelopeError)
    })

    it('still accepts an unknown unprotected parameter carrying a well-formed nested map', () => {
      // The check above must not turn into a blanket ban on extensions.
      const nested = new Map<CborValue, CborValue>([
        [Uint8Array.from([1, 2]), 'first'],
        [Uint8Array.from([3, 4]), 'second'],
      ])
      const bytes = cborEncode(
        new Tagged(TAG_ENCRYPT0, [hexToBytes(MINIMAL_PROTECTED_HEADER_HEX), new Map([[100, nested]]), null]),
        rfc8949EncodeOptions
      )
      assert.strictEqual((decodeEnvelope(bytes).unprotectedHeader.get(100) as Map<CborValue, CborValue>).size, 2)
    })

    it('rejects data that is not well-formed CBOR at all', () => {
      assert.throws(() => decodeEnvelope(Uint8Array.from([0xff, 0xff, 0xff])), MalformedEnvelopeError)
    })

    it('rejects a top-level value that is not tagged', () => {
      // 0x03 = the plain integer 3, no tag wrapper at all.
      assert.throws(() => decodeEnvelope(Uint8Array.from([0x03])), MalformedEnvelopeError)
    })

    it('rejects a CBOR tag that is neither 16 nor 96', () => {
      // Tag 17 (0xD1) wrapping the same 3-element array a tag-16 body would use.
      const bytes = encodeEnvelope(MINIMAL_INPUT)
      const wrongTag = Uint8Array.from([0xd1, ...bytes.subarray(1)])
      assert.throws(() => decodeEnvelope(wrongTag), MalformedEnvelopeError)
    })

    it('rejects a tag-16 array with the wrong number of elements', () => {
      // Array of 2 elements instead of 3: tag 16, then just [protected, unprotected].
      const bytes = encodeEnvelope(MINIMAL_INPUT)
      const truncatedArray = Uint8Array.from([0xd0, 0x82, ...bytes.subarray(2, bytes.length - 1)])
      assert.throws(() => decodeEnvelope(truncatedArray), MalformedEnvelopeError)
    })

    it('rejects a tag-96 array with the wrong number of elements (missing recipients)', () => {
      // Tag 96 (COSE_Encrypt) but only a 3-element array, like a tag-16 body.
      const bytes = encodeEnvelope(MINIMAL_INPUT)
      const bodyAsTag96 = Uint8Array.from([0xd8, 0x60, ...bytes.subarray(1)])
      assert.throws(() => decodeEnvelope(bodyAsTag96), MalformedEnvelopeError)
    })

    it('rejects a ciphertext element that is not null', () => {
      const raw = hexToBytes(MINIMAL_ENVELOPE_TAG16_HEX)
      const withCiphertext = raw.slice()
      withCiphertext[withCiphertext.length - 1] = 0x00 // f6 (null) -> 00 (uint 0)
      assert.throws(() => decodeEnvelope(withCiphertext), MalformedEnvelopeError)
    })

    it('rejects an empty recipients array for tag 96', () => {
      const bytes = encodeEnvelope({ ...MINIMAL_INPUT, recipients: [RECIPIENT] })
      // Replace `81 <recipient tuple>` (array/1) with `80` (array/0, empty),
      // dropping the recipient tuple bytes that followed it. The tuple is
      // [protected: bstr h'' (40), unprotected: map {1:-5, 4: 2-byte kid}
      // (a2 01 24 04 42 aabb, 7 bytes), ciphertext: 40-byte bstr (58 28 +
      // 40 bytes, 42 bytes total)], wrapped in its own array/3 marker (83) —
      // 1 + 1 + 7 + 42 = 51 bytes, plus the recipients array/1 marker (81)
      // itself: 52 bytes.
      const recipientsArrayStart = bytes.length - 52
      const withEmptyRecipients = Uint8Array.from([...bytes.subarray(0, recipientsArrayStart), 0x80])
      assert.throws(() => decodeEnvelope(withEmptyRecipients), MalformedEnvelopeError)
    })

    it('rejects a recipient that is not a 3-element array', () => {
      const raw = hexToBytes(MINIMAL_ENVELOPE_TAG16_HEX)
      const bodyContent = raw.subarray(2) // protected + unprotected + null, 64 bytes
      // Recipients: [ [ h'a10124', {} ] ] — a 2-element tuple, missing ciphertext.
      const badRecipientsSection = hexToBytes('818243a10124a0')
      const bytes = Uint8Array.from([0xd8, 0x60, 0x84, ...bodyContent, ...badRecipientsSection])
      assert.throws(() => decodeEnvelope(bytes), MalformedEnvelopeError)
    })

    it('rejects an iv of the wrong length for the declared alg', () => {
      // alg 3 (whole-object) requires a 12-byte iv; hand-craft a protected
      // header carrying the chunked scheme's 7-byte base nonce instead.
      // encodeProtectedHeader validates this itself (see cose-encode.test.ts's
      // "rejects an iv length that does not match the scheme"), so the bytes
      // are built directly here to prove decodeEnvelope rejects it
      // independently, on bytes its own encoder would never produce.
      const protectedBytes = concatBytes(
        Uint8Array.from([0xa3, 0x01, 0x03, 0x05, 0x47]),
        FIXTURE_BASE_NONCE_7,
        Uint8Array.from([0x10, 0x78, 0x28]),
        utf8Bytes(ENVELOPE_TYPE)
      )
      const bytes = concatBytes(
        Uint8Array.from([0xd0, 0x83, 0x58, protectedBytes.length]),
        protectedBytes,
        Uint8Array.from([0xa0, 0xf6])
      )
      assert.throws(() => decodeEnvelope(bytes), MalformedEnvelopeError)
    })

    it('rejects an envelope carrying the iv in the unprotected map, where it would escape the AAD', () => {
      // The shape every pre-amendment-3 encoder produced: a protected header
      // without label 5, and the IV alongside it in the unprotected bucket.
      const protectedBytes = concatBytes(
        Uint8Array.from([0xa2, 0x01, 0x03, 0x10, 0x78, 0x28]),
        utf8Bytes(ENVELOPE_TYPE)
      )
      const bytes = concatBytes(
        Uint8Array.from([0xd0, 0x83, 0x58, protectedBytes.length]),
        protectedBytes,
        Uint8Array.from([0xa1, 0x05, 0x4c]),
        FIXTURE_IV_12,
        Uint8Array.from([0xf6])
      )
      assert.throws(() => decodeEnvelope(bytes), MalformedEnvelopeError)
    })

    it('rejects a duplicate map key in the unprotected header', () => {
      // Tag 16, array of 3: [protected, { 100: 1, 100: 2 }, null]. Label 100
      // rather than a header this profile defines, so the rejection can only
      // come from the CBOR decoder's duplicate-key rule — which fires before
      // any header validation runs.
      const protectedBytes = hexToBytes(MINIMAL_PROTECTED_HEADER_HEX)
      const duplicateUnprotected = Uint8Array.from([0xa2, 0x18, 0x64, 0x01, 0x18, 0x64, 0x02])
      const bytes = concatBytes(
        Uint8Array.from([0xd0, 0x83, 0x58, protectedBytes.length]),
        protectedBytes,
        duplicateUnprotected,
        Uint8Array.from([0xf6])
      )
      assert.throws(() => decodeEnvelope(bytes), MalformedEnvelopeError)
    })

    it('rejects a label appearing in both the protected and unprotected maps', () => {
      // content_type (label 3) in both buckets, with different values. RFC
      // 9052 merely recommends rejecting this and otherwise prefers the
      // protected copy; this profile refuses to resolve the ambiguity on the
      // sender's behalf. Label 3 rather than the iv, so the rejection is the
      // overlap rule and not the separate "iv must be protected" rule. See
      // cose-headers.test.ts for the headers-level version of this check.
      const protectedBytes = concatBytes(
        Uint8Array.from([0xa4, 0x01, 0x03, 0x03, 0x69]),
        utf8Bytes('video/mp4'),
        Uint8Array.from([0x05, 0x4c]),
        FIXTURE_IV_12,
        Uint8Array.from([0x10, 0x78, 0x28]),
        utf8Bytes(ENVELOPE_TYPE)
      )
      const unprotected = concatBytes(Uint8Array.from([0xa1, 0x03, 0x6a]), utf8Bytes('text/plain'))
      const bytes = concatBytes(
        Uint8Array.from([0xd0, 0x83, 0x58, protectedBytes.length]),
        protectedBytes,
        unprotected,
        Uint8Array.from([0xf6])
      )
      assert.throws(() => decodeEnvelope(bytes), MalformedEnvelopeError)
    })

    it('enforces the 1 MiB envelope decode ceiling even when the full buffer contains enough bytes to satisfy a huge declared length', () => {
      // A protected bstr declaring a length of exactly MAX_ENVELOPE_SIZE,
      // inside a buffer that genuinely has that many bytes available. If
      // decode fed the whole buffer to the CBOR decoder, this would parse
      // "successfully" into a MAX_ENVELOPE_SIZE-byte allocation before any
      // header validation ever ran. Bounding the decoder's input to a
      // MAX_ENVELOPE_SIZE-byte prefix (see decode.ts) makes that allocation
      // structurally impossible: the prefix cannot contain the array
      // header, the bstr header, AND that many content bytes.
      const declaredLength = MAX_ENVELOPE_SIZE
      const bstrHeader = Uint8Array.from([
        0x5a, // bstr, 4-byte length follows
        (declaredLength >>> 24) & 0xff,
        (declaredLength >>> 16) & 0xff,
        (declaredLength >>> 8) & 0xff,
        declaredLength & 0xff,
      ])
      const prefix = Uint8Array.from([0xd0, 0x83, ...bstrHeader])
      const filler = new Uint8Array(declaredLength + 4096) // enough real bytes to satisfy the declared length in full
      const blob = Uint8Array.from([...prefix, ...filler])

      assert.throws(() => decodeEnvelope(blob), MalformedEnvelopeError)
    })
  })
})
