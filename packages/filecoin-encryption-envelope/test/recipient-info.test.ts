import assert from 'node:assert'
import { encode as cborEncode, rfc8949EncodeOptions } from 'cborg'
import { ALG_AES_256_GCM } from '../src/constants.ts'
import { ALG_A256KW, ALG_ECDH_ES_A256KW, HEADER_ALG, HEADER_KID } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encodeEnvelope, type RecipientInput } from '../src/cose/encode.ts'
import type { CborValue } from '../src/cose/headers.ts'
import { toRecipientInfo } from '../src/recipients/info.ts'
import { FIXTURE_IV_12 } from './cose-fixtures.ts'

function encodeAndDecodeRecipient(recipient: RecipientInput) {
  const encoded = encodeEnvelope({
    protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 },
    recipients: [recipient],
  })
  return { encoded, decoded: decodeEnvelope(encoded).recipients[0] }
}

describe('recipient interfaces', () => {
  it('extracts A256KW alg and kid from the unprotected recipient map', () => {
    const kid = Uint8Array.from([0xaa, 0xbb])
    const wrappedKey = Uint8Array.from([1, 2, 3])
    const { decoded } = encodeAndDecodeRecipient({
      protectedBytes: new Uint8Array(0),
      unprotected: new Map<number, CborValue>([
        [HEADER_ALG, ALG_A256KW],
        [HEADER_KID, kid],
      ]),
      ciphertext: wrappedKey,
    })
    const info = toRecipientInfo(decoded, 3)

    assert.strictEqual(info.index, 3)
    assert.strictEqual(info.alg, ALG_A256KW)
    assert.deepStrictEqual(info.kid, kid)
    assert.strictEqual(info.protected.size, 0)
    assert.deepStrictEqual(info.unprotected.get(HEADER_KID), kid)
    assert.deepStrictEqual(info.wrappedKey, wrappedKey)
  })

  it('retains both decoded and serialized protected headers for future recipient algorithms', () => {
    const kid = Uint8Array.from([0xcc])
    const protectedBytes = cborEncode(
      new Map<number, CborValue>([
        [HEADER_ALG, ALG_ECDH_ES_A256KW],
        [HEADER_KID, kid],
      ]),
      rfc8949EncodeOptions
    )
    const { decoded } = encodeAndDecodeRecipient({
      protectedBytes,
      unprotected: new Map(),
      ciphertext: Uint8Array.from([4, 5, 6]),
    })
    const info = toRecipientInfo(decoded, 0)

    assert.strictEqual(info.alg, ALG_ECDH_ES_A256KW)
    assert.deepStrictEqual(info.kid, kid)
    assert.deepStrictEqual(info.protectedBytes, protectedBytes)
    assert.strictEqual(info.protected.get(HEADER_ALG), ALG_ECDH_ES_A256KW)
    assert.deepStrictEqual(info.kid, info.protected.get(HEADER_KID))
  })

  it('isolates the unwrapper view from decoder-owned recipient data', () => {
    const originalKid = Uint8Array.from([0xaa, 0xbb])
    const nestedBytes = Uint8Array.from([7, 8])
    const originalProtectedBytes = cborEncode(
      new Map<number, CborValue>([
        [HEADER_ALG, ALG_ECDH_ES_A256KW],
        [HEADER_KID, originalKid],
      ]),
      rfc8949EncodeOptions
    )
    const { encoded, decoded } = encodeAndDecodeRecipient({
      protectedBytes: originalProtectedBytes,
      unprotected: new Map<number, CborValue>([[100, new Map<CborValue, CborValue>([['nested', nestedBytes]])]]),
      ciphertext: Uint8Array.from([9, 10]),
    })
    const originalEncoded = new Uint8Array(encoded)
    const info = toRecipientInfo(decoded, 0)

    info.kid?.fill(0)
    info.protectedBytes.fill(0)
    info.wrappedKey.fill(0)
    const infoNested = info.unprotected.get(100)
    assert.ok(infoNested instanceof Map)
    const infoNestedBytes = infoNested.get('nested')
    assert.ok(infoNestedBytes instanceof Uint8Array)
    infoNestedBytes.fill(0)
    ;(info.unprotected as Map<number | string, CborValue>).set(101, 'callback-owned')

    assert.deepStrictEqual(decoded.protected.get(HEADER_KID), originalKid)
    assert.deepStrictEqual(decoded.protectedBytes, originalProtectedBytes)
    assert.deepStrictEqual(decoded.ciphertext, Uint8Array.from([9, 10]))
    const decodedNested = decoded.unprotected.get(100)
    assert.ok(decodedNested instanceof Map)
    assert.deepStrictEqual(decodedNested.get('nested'), nestedBytes)
    assert.strictEqual(decoded.unprotected.has(101), false)
    assert.deepStrictEqual(encoded, originalEncoded)
  })

  it('passes a text algorithm identifier through to a custom unwrapper view', () => {
    const { decoded } = encodeAndDecodeRecipient({
      protectedBytes: new Uint8Array(0),
      unprotected: new Map([[HEADER_ALG, 'custom-wrap']]),
      ciphertext: Uint8Array.from([1, 2]),
    })

    assert.strictEqual(toRecipientInfo(decoded, 0).alg, 'custom-wrap')
  })
})
