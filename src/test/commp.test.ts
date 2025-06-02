/* globals describe it */

/**
 * Basic tests for CommP utilities
 */

import { assert } from 'chai'
import { CID } from 'multiformats/cid'
import { asCommP, calculate, createCommPStream } from '../commp/index.js'

// https://github.com/filecoin-project/go-fil-commp-hashhash/blob/master/testdata/zero.txt
const zeroCommpFixture = `
  96,128,baga6ea4seaqdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
  126,128,baga6ea4seaqdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
  127,128,baga6ea4seaqdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
  192,256,baga6ea4seaqgiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy
  253,256,baga6ea4seaqgiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy
  254,256,baga6ea4seaqgiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy
  255,512,baga6ea4seaqfpirydiugkk7up5v666wkm6n6jlw6lby2wxht5mwaqekerdfykjq
  256,512,baga6ea4seaqfpirydiugkk7up5v666wkm6n6jlw6lby2wxht5mwaqekerdfykjq
  384,512,baga6ea4seaqfpirydiugkk7up5v666wkm6n6jlw6lby2wxht5mwaqekerdfykjq
  507,512,baga6ea4seaqfpirydiugkk7up5v666wkm6n6jlw6lby2wxht5mwaqekerdfykjq
  508,512,baga6ea4seaqfpirydiugkk7up5v666wkm6n6jlw6lby2wxht5mwaqekerdfykjq
  509,1024,baga6ea4seaqb66wjlfkrbye6uqoemcyxmqylwmrm235uclwfpsyx3ge2imidoly
  512,1024,baga6ea4seaqb66wjlfkrbye6uqoemcyxmqylwmrm235uclwfpsyx3ge2imidoly
  768,1024,baga6ea4seaqb66wjlfkrbye6uqoemcyxmqylwmrm235uclwfpsyx3ge2imidoly
  1015,1024,baga6ea4seaqb66wjlfkrbye6uqoemcyxmqylwmrm235uclwfpsyx3ge2imidoly
  1016,1024,baga6ea4seaqb66wjlfkrbye6uqoemcyxmqylwmrm235uclwfpsyx3ge2imidoly
  1017,2048,baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy
  1024,2048,baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy
`.trim().split('\n').map((line) => {
    const parts = line.trim().split(',')
    return [parseInt(parts[0], 10), parseInt(parts[1], 10), CID.parse(parts[2].trim())] as [number, number, CID]
  })

describe('CommP utilities', () => {
  const validCommPString = 'baga6ea4seaqjtovkwk4myyzj56eztkh5pzsk5upksan6f5outesy62bsvl4dsha'
  const invalidCidString = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' // CIDv0, not CommP

  describe('asCommP', () => {
    it('should accept valid CommP string', () => {
      const result = asCommP(validCommPString)
      assert.isNotNull(result)
      assert.strictEqual(result?.toString(), validCommPString)
    })

    it('should accept CommP CID object', () => {
      const cid = CID.parse(validCommPString)
      const result = asCommP(cid)
      assert.isNotNull(result)
      assert.strictEqual(result?.toString(), validCommPString)
    })

    it('should return null for invalid CommP string', () => {
      const result = asCommP(invalidCidString)
      assert.isNull(result)
    })

    it('should return null for invalid CID object', () => {
      const invalidCid = CID.parse(invalidCidString)
      const result = asCommP(invalidCid)
      assert.isNull(result)
    })

    it('should return null for malformed string', () => {
      const result = asCommP('not-a-cid')
      assert.isNull(result)
    })
  })

  describe('edge cases', () => {
    it('should return null for null input', () => {
      const result = asCommP(null as any)
      assert.isNull(result)
    })

    it('should return null for undefined input', () => {
      const result = asCommP(undefined as any)
      assert.isNull(result)
    })

    it('should return null for number input', () => {
      const result = asCommP(123 as any)
      assert.isNull(result)
    })

    it('should return null for object that is not a CID', () => {
      const result = asCommP({} as any)
      assert.isNull(result)
    })
  })

  // These are not exhaustive tests, but tell us that our use of the upstream
  // CommP calculation library and our transformation of the output to CIDs is
  // correct. We'll defer to the upstream library for more detailed tests.
  describe('Calculate CommP from fixture data', () => {
    zeroCommpFixture.forEach(([size, , expected]) => {
      it(`should parse CommP for size ${size}`, () => {
        // CommP for an empty byte array of given size
        const zeroBytes = new Uint8Array(size)
        const result = calculate(zeroBytes)
        assert.isNotNull(result)
        assert.strictEqual(result.toString(), expected.toString())
      })
    })
  })

  describe('createCommPStream', () => {
    it('should calculate same CommP as calculate() function', async () => {
      const testData = new Uint8Array(4096).fill(1)

      // Calculate using regular function
      const expectedCommP = calculate(testData)

      // Calculate using stream
      const { stream, getCommP } = createCommPStream()

      // Create a readable stream from our test data
      const readable = new ReadableStream({
        start (controller) {
          controller.enqueue(testData)
          controller.close()
        }
      })

      // Pipe through CommP stream and consume
      const reader = readable.pipeThrough(stream).getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      const streamCommP = getCommP()
      assert.isNotNull(streamCommP)
      assert.strictEqual(streamCommP?.toString(), expectedCommP.toString())
    })

    it('should handle chunked data correctly', async () => {
      const chunk1 = new Uint8Array([1, 2, 3, 4])
      const chunk2 = new Uint8Array([5, 6, 7, 8])
      const chunk3 = new Uint8Array(1024).fill(1)
      const fullData = new Uint8Array([...chunk1, ...chunk2, ...chunk3])

      // Calculate expected CommP
      const expectedCommP = calculate(fullData)

      // Calculate using stream with chunks
      const { stream, getCommP } = createCommPStream()

      const readable = new ReadableStream({
        start (controller) {
          controller.enqueue(chunk1)
          controller.enqueue(chunk2)
          controller.enqueue(chunk3)
          controller.close()
        }
      })

      const reader = readable.pipeThrough(stream).getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      const streamCommP = getCommP()
      assert.isNotNull(streamCommP)
      assert.strictEqual(streamCommP?.toString(), expectedCommP.toString())
    })

    it('should return null before stream is finished', () => {
      const { getCommP } = createCommPStream()

      // Should be null before any data
      assert.isNull(getCommP())

      // Note: We can't easily test the "during streaming" state without
      // more complex async coordination, so we keep this test simple
    })
  })
})
