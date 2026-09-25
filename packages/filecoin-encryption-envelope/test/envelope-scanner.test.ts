import assert from 'node:assert'
import { encode as cborEncode, rfc8949EncodeOptions } from 'cborg'
import { ALG_AES_256_GCM } from '../src/constants.ts'
import { ALG_A256KW, MAX_APP_METADATA_DEPTH, MAX_ENVELOPE_SIZE } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import type { EncodeEnvelopeInput, RecipientInput } from '../src/cose/encode.ts'
import { encodeEnvelope } from '../src/cose/encode.ts'
import { createEnvelopeScanner, createEnvelopeScanState, scanEnvelopeStep } from '../src/cose/envelope-scanner.ts'
import type { CborValue } from '../src/cose/headers.ts'
import { decodeExact, encodeProtectedHeader } from '../src/cose/headers.ts'
import { MalformedEnvelopeError } from '../src/errors.ts'
import { concatBytes, FIXTURE_IV_12, hexToBytes, MINIMAL_ENVELOPE_TAG16_HEX } from './cose-fixtures.ts'

// Two recipients, one with a kid, mirroring the aes-gcm-recipients.test.ts fixtures.
const RECIPIENT_WITH_KID: RecipientInput = {
  protectedBytes: new Uint8Array(0),
  unprotected: new Map<number, CborValue>([
    [1, ALG_A256KW],
    [4, Uint8Array.from([0xaa, 0xbb])],
  ]),
  ciphertext: new Uint8Array(40).fill(9),
}
const RECIPIENT_NO_KID: RecipientInput = {
  protectedBytes: new Uint8Array(0),
  unprotected: new Map<number, CborValue>([[1, ALG_A256KW]]),
  ciphertext: new Uint8Array(40).fill(7),
}

const ENVELOPE_INPUT: EncodeEnvelopeInput = {
  protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 },
  recipients: [RECIPIENT_WITH_KID, RECIPIENT_NO_KID],
}
const ENVELOPE_BYTES = encodeEnvelope(ENVELOPE_INPUT)
const CIPHERTEXT = Uint8Array.from({ length: 37 }, (_, i) => i)
const FULL = concatBytes(ENVELOPE_BYTES, CIPHERTEXT)
const EXPECTED_DECODED = decodeEnvelope(FULL)

function uint32be(n: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, n, false)
  return bytes
}

/** `d0` (tag 16) `83` (array/3) `<protected bstr>` `a0` (empty map) `f6` (null) -- hand-wrapped so it can exceed MAX_ENVELOPE_SIZE, which `encodeEnvelope` itself refuses to produce. */
function rawTag16Envelope(protectedBytes: Uint8Array): Uint8Array {
  return concatBytes(
    Uint8Array.from([0xd0, 0x83]),
    cborEncode(protectedBytes, rfc8949EncodeOptions),
    Uint8Array.from([0xa0, 0xf6])
  )
}

/** Build a tag-16 envelope of exactly `targetSize` bytes by tuning an app_metadata padding byte string. */
function envelopeOfExactSize(targetSize: number): Uint8Array {
  let n = targetSize
  for (let attempt = 0; attempt < 10; attempt++) {
    const protectedBytes = encodeProtectedHeader({
      alg: ALG_AES_256_GCM,
      iv: FIXTURE_IV_12,
      appMetadata: { pad: new Uint8Array(Math.max(n, 0)) },
    })
    const bytes = rawTag16Envelope(protectedBytes)
    if (bytes.length === targetSize) return bytes
    n += targetSize - bytes.length
  }
  throw new Error('test helper: envelopeOfExactSize did not converge')
}

describe('createEnvelopeScanner', () => {
  it('gives the same decoded result and correct rest at every split point within the envelope', () => {
    // Splitting strictly before the envelope ends: the first push always
    // needs more, so the fallback second push (envelope tail + all of the
    // ciphertext) is the one that completes and reports the full rest.
    // Splits at or after the envelope boundary are covered separately below.
    for (let k = 0; k < ENVELOPE_BYTES.length; k++) {
      const scanner = createEnvelopeScanner()
      const first = scanner.push(FULL.subarray(0, k))
      assert.strictEqual(first, undefined, `expected split k=${k} to need more input`)
      const result = scanner.push(FULL.subarray(k))
      if (result === undefined) {
        throw new Error(`test bug: envelope did not complete for split k=${k}`)
      }
      assert.deepStrictEqual(result.decoded, EXPECTED_DECODED)
      assert.deepStrictEqual(result.rest, CIPHERTEXT)
    }
  })

  it('feeds one byte at a time and still completes correctly', () => {
    const scanner = createEnvelopeScanner()
    let result: ReturnType<typeof scanner.push>
    for (let i = 0; i < ENVELOPE_BYTES.length && result === undefined; i++) {
      result = scanner.push(FULL.subarray(i, i + 1))
    }
    if (result === undefined) {
      throw new Error('test bug: did not complete')
    }
    assert.deepStrictEqual(result.decoded, EXPECTED_DECODED)
    // Only envelope bytes were ever fed in, one at a time; the ciphertext
    // was never pushed, so this push's own rest is empty.
    assert.strictEqual(result.rest.length, 0)
  })

  it('handles the minimal tag-16 envelope too', () => {
    const minimal = hexToBytes(MINIMAL_ENVELOPE_TAG16_HEX)
    const scanner = createEnvelopeScanner()
    const result = scanner.push(minimal)
    if (result === undefined) {
      throw new Error('test bug: did not complete')
    }
    assert.deepStrictEqual(result.decoded, decodeEnvelope(minimal))
    assert.strictEqual(result.rest.length, 0)
  })

  it('accepts a safe integer recipient label encoded in eight bytes', () => {
    const label = 4294967296
    const envelope = encodeEnvelope({
      protectedHeader: ENVELOPE_INPUT.protectedHeader,
      recipients: [
        {
          ...RECIPIENT_NO_KID,
          unprotected: new Map<number, CborValue>([
            [1, ALG_A256KW],
            [label, true],
          ]),
        },
      ],
    })
    const result = createEnvelopeScanner().push(envelope)

    assert.strictEqual(result?.decoded.recipients[0].unprotected.get(label), true)
  })

  it('gives a rest view into the same block when envelope and ciphertext arrive together', () => {
    const scanner = createEnvelopeScanner()
    const result = scanner.push(FULL)
    if (result === undefined) {
      throw new Error('test bug: did not complete')
    }
    assert.strictEqual(result.rest.buffer, FULL.buffer)
    assert.deepStrictEqual(result.rest, CIPHERTEXT)
  })

  it('gives an empty rest when the envelope ends exactly at a block boundary', () => {
    const scanner = createEnvelopeScanner()
    const result = scanner.push(ENVELOPE_BYTES)
    if (result === undefined) {
      throw new Error('test bug: did not complete')
    }
    assert.strictEqual(result.rest.length, 0)
  })

  it('is unaffected by mutating a pushed block after completion', () => {
    const block = Uint8Array.from(FULL)
    const scanner = createEnvelopeScanner()
    const result = scanner.push(block)
    if (result === undefined) {
      throw new Error('test bug: did not complete')
    }
    const protectedBytesBefore = new Uint8Array(result.decoded.protectedHeader.bytes)
    const ivBefore = new Uint8Array(result.decoded.protectedHeader.iv)
    const recipientCountBefore = result.decoded.recipients.length
    const firstCiphertextBefore = new Uint8Array(result.decoded.recipients[0].ciphertext)

    block.fill(0xff) // mutate the whole original block, envelope region included

    assert.deepStrictEqual(result.decoded.protectedHeader.bytes, protectedBytesBefore)
    assert.deepStrictEqual(result.decoded.protectedHeader.iv, ivBefore)
    assert.strictEqual(result.decoded.recipients.length, recipientCountBefore)
    assert.deepStrictEqual(result.decoded.recipients[0].ciphertext, firstCiphertextBefore)
  })

  it('finish() throws when the source ends mid-envelope', () => {
    const scanner = createEnvelopeScanner()
    const result = scanner.push(ENVELOPE_BYTES.subarray(0, ENVELOPE_BYTES.length - 5))
    assert.strictEqual(result, undefined)
    assert.throws(() => scanner.finish(), MalformedEnvelopeError)
  })

  it('finish() is a no-op once the envelope already completed', () => {
    const scanner = createEnvelopeScanner()
    scanner.push(ENVELOPE_BYTES)
    assert.doesNotThrow(() => scanner.finish())
  })

  it("surfaces decodeEnvelope's error for a structurally complete but profile-invalid envelope (wrong tag)", () => {
    const protectedBytes = encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 })
    // d1 = tag 17: structurally identical to a real envelope, but not tag 16 or 96.
    const badTag = concatBytes(
      Uint8Array.from([0xd1, 0x83]),
      cborEncode(protectedBytes, rfc8949EncodeOptions),
      Uint8Array.from([0xa0, 0xf6])
    )
    const scanner = createEnvelopeScanner()
    assert.throws(() => scanner.push(badTag), MalformedEnvelopeError)
  })

  describe('budget rejections happen before content bytes arrive', () => {
    it('rejects a byte string head declaring more than the remaining budget', () => {
      // major 2 (byte string), additional info 26 (4-byte length)
      const head = concatBytes(Uint8Array.from([0x5a]), uint32be(MAX_ENVELOPE_SIZE))
      const scanner = createEnvelopeScanner()
      assert.throws(() => scanner.push(head), MalformedEnvelopeError)
    })

    it('rejects an array count declaring more than the remaining budget', () => {
      // major 4 (array), additional info 26 (4-byte length)
      const head = concatBytes(Uint8Array.from([0x9a]), uint32be(MAX_ENVELOPE_SIZE))
      const scanner = createEnvelopeScanner()
      assert.throws(() => scanner.push(head), MalformedEnvelopeError)
    })

    it('rejects a map count declaring more than the remaining budget', () => {
      // major 5 (map), additional info 26 (4-byte length); each pair is 2 items.
      const head = concatBytes(Uint8Array.from([0xba]), uint32be(Math.ceil(MAX_ENVELOPE_SIZE / 2)))
      const scanner = createEnvelopeScanner()
      assert.throws(() => scanner.push(head), MalformedEnvelopeError)
    })
  })

  it('completes an envelope of exactly MAX_ENVELOPE_SIZE bytes, and rejects one byte over as soon as certain', () => {
    const atLimit = envelopeOfExactSize(MAX_ENVELOPE_SIZE)
    assert.strictEqual(atLimit.length, MAX_ENVELOPE_SIZE)
    const scanner = createEnvelopeScanner()
    const result = scanner.push(atLimit)
    if (result === undefined) {
      throw new Error('test bug: at-limit envelope did not complete')
    }
    assert.strictEqual(result.rest.length, 0)

    // The overage is entirely inside the protected header's own byte string,
    // so the scanner rejects it as soon as that string's declared length is
    // known -- from the outer tag/array/bstr-head bytes alone, well before
    // anywhere near a megabyte of content would need to arrive.
    const oneOver = envelopeOfExactSize(MAX_ENVELOPE_SIZE + 1)
    const overScanner = createEnvelopeScanner()
    assert.throws(() => overScanner.push(oneOver), MalformedEnvelopeError)
  })
})

describe('scanEnvelopeStep', () => {
  function stepOnce(bytes: Uint8Array): number | undefined {
    return scanEnvelopeStep(bytes, createEnvelopeScanState())
  }

  it('rejects an indefinite-length byte string', () => {
    assert.throws(() => stepOnce(Uint8Array.from([0x5f])), MalformedEnvelopeError)
  })

  it('rejects an indefinite-length array', () => {
    assert.throws(() => stepOnce(Uint8Array.from([0x9f])), MalformedEnvelopeError)
  })

  it('rejects an indefinite-length map', () => {
    assert.throws(() => stepOnce(Uint8Array.from([0xbf])), MalformedEnvelopeError)
  })

  it('rejects reserved additional information', () => {
    assert.throws(() => stepOnce(Uint8Array.from([0x1c])), MalformedEnvelopeError) // major 0, info 28
  })

  it('rejects a top-level break code', () => {
    assert.throws(() => stepOnce(Uint8Array.from([0xff])), MalformedEnvelopeError) // major 7, info 31
  })

  it('rejects an 8-byte length with a nonzero high half', () => {
    // major 2 (byte string), additional info 27 (8-byte length), high half = 1
    const bytes = Uint8Array.from([0x5b, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00])
    assert.throws(() => stepOnce(bytes), MalformedEnvelopeError)
  })

  it('needs more input for a head split across the available bytes, and leaves the cursor at its start', () => {
    // major 2, additional info 26 (4-byte length): 5-byte head, only 3 bytes given.
    const state = createEnvelopeScanState()
    const partialHead = Uint8Array.from([0x5a, 0x00, 0x00])
    assert.strictEqual(scanEnvelopeStep(partialHead, state), undefined)
    assert.strictEqual(state.cursor, 0)
  })

  describe('depth, cross-checked against decodeExact', () => {
    function nestedArray(depth: number): unknown[] {
      let value: unknown[] = []
      for (let i = 0; i < depth; i++) {
        value = [value]
      }
      return value
    }
    function encodeBare(value: unknown): Uint8Array {
      return cborEncode(value, rfc8949EncodeOptions)
    }

    it('accepts nesting exactly at the limit and rejects one level deeper, matching decodeExact', () => {
      const lastAccepted = encodeBare(nestedArray(MAX_APP_METADATA_DEPTH - 1))
      assert.strictEqual(scanEnvelopeStep(lastAccepted, createEnvelopeScanState()), lastAccepted.length)
      assert.doesNotThrow(() => decodeExact(lastAccepted))

      const firstRejected = encodeBare(nestedArray(MAX_APP_METADATA_DEPTH))
      assert.throws(() => scanEnvelopeStep(firstRejected, createEnvelopeScanState()), MalformedEnvelopeError)
      // decodeExact's own tokenizer throws a raw Error at this layer (only
      // higher callers like decodeEnvelope wrap it) -- the point here is the
      // shared depth boundary, not the error class.
      assert.throws(() => decodeExact(firstRejected), Error)
    })
  })

  it('runs in linear time: reads stay bounded as input trickles in one byte at a time', () => {
    const manyRecipients = Array.from({ length: 20 }, () => RECIPIENT_NO_KID)
    const bytes = encodeEnvelope({ ...ENVELOPE_INPUT, recipients: manyRecipients })

    let reads = 0
    let exposedLength = 0
    const countingView = new Proxy(bytes, {
      get(target, prop, receiver) {
        if (prop === 'length') return exposedLength
        if (typeof prop === 'string' && Number.isInteger(Number(prop))) {
          const index = Number(prop)
          assert.ok(index < exposedLength, `read at index ${index} beyond the ${exposedLength} bytes exposed so far`)
          reads++
        }
        return Reflect.get(target, prop, receiver)
      },
    })

    const state = createEnvelopeScanState()
    let steps = 0
    let previousCursor = 0
    let result: number | undefined
    while (result === undefined) {
      if (exposedLength >= bytes.length) {
        throw new Error('test bug: never completed')
      }
      exposedLength++
      steps++
      result = scanEnvelopeStep(countingView, state)
      assert.ok(state.cursor >= previousCursor, 'cursor must never move backwards')
      previousCursor = state.cursor
    }

    assert.strictEqual(result, bytes.length)
    assert.strictEqual(previousCursor, bytes.length)
    assert.ok(reads <= bytes.length + 9 * steps, `reads=${reads} exceeded bound of ${bytes.length + 9 * steps}`)
  })
})
