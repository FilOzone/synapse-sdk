import assert from 'node:assert'
import { TAG_ENCRYPT, TAG_ENCRYPT0 } from '../src/cose/constants.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import { MalformedEnvelopeError } from '../src/errors.ts'
import { hexToBytes } from './cose-fixtures.ts'

const PROTECTED_BYTES = Uint8Array.from([1, 2, 3])

describe('encStructure', () => {
  describe('byte-exact vectors', () => {
    it('builds the exact hand-derived Enc_structure for tag 16 (context "Encrypt0")', () => {
      // [ "Encrypt0", h'010203', h'' ]
      assert.deepStrictEqual(encStructure(TAG_ENCRYPT0, PROTECTED_BYTES), hexToBytes('8368456e6372797074304301020340'))
    })

    it('builds the exact hand-derived Enc_structure for tag 96 (context "Encrypt")', () => {
      // [ "Encrypt", h'010203', h'' ]
      assert.deepStrictEqual(encStructure(TAG_ENCRYPT, PROTECTED_BYTES), hexToBytes('8367456e63727970744301020340'))
    })
  })

  describe('context depends on the tag, not on recipient presence', () => {
    it('rewrapping the same protected bytes under tag 96 changes the AAD', () => {
      // The bug this guards against: an earlier implementation always used
      // "Encrypt0", so adding recipients to an existing body silently kept
      // the old AAD instead of updating it for the new container.
      const asEncrypt0 = encStructure(TAG_ENCRYPT0, PROTECTED_BYTES)
      const asEncrypt = encStructure(TAG_ENCRYPT, PROTECTED_BYTES)
      assert.notDeepStrictEqual(asEncrypt0, asEncrypt)
      assert.deepStrictEqual(asEncrypt0, hexToBytes('8368456e6372797074304301020340'))
    })
  })

  it('rejects protected header bytes that are not a Uint8Array', () => {
    // A string or array encodes to a different CBOR major type, so the AAD
    // that comes out authenticates nothing another implementation would
    // reproduce — and nothing about that failure is loud.
    for (const notBytes of ['010203', [1, 2, 3], null, undefined]) {
      assert.throws(
        // @ts-expect-error deliberately passing a non-Uint8Array from untyped JS
        () => encStructure(TAG_ENCRYPT0, notBytes),
        MalformedEnvelopeError,
        `for ${String(notBytes)}`
      )
    }
  })

  it('rejects an envelope tag that is neither 16 nor 96', () => {
    // @ts-expect-error deliberately passing an unsupported tag
    assert.throws(() => encStructure(17, PROTECTED_BYTES), MalformedEnvelopeError)
  })
})
