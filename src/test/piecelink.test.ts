/* globals describe it */

/**
 * Basic tests for PieceLink utilities
 */

import { assert } from 'chai'
import { CID } from 'multiformats/cid'
import { PieceLink, asPieceLink, asLegacyPieceLink, calculate, createPieceLinkStream } from '../piecelink/index.js'
import { Size, toLink } from '@web3-storage/data-segment/piece'
import { API } from '@web3-storage/data-segment'

// https://github.com/filecoin-project/go-fil-commp-hashhash/blob/master/testdata/zero.txt
const zeroPieceLinkFixture = `
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

function toPieceLink (size: bigint, cid: CID): PieceLink {
  const height = Size.Unpadded.toHeight(size)
  const padding = Size.Unpadded.toPadding(size)
  const root = cid.bytes.slice(-32)
  const piece: API.Piece = { height, root, padding }
  return toLink(piece)
}

describe('PieceLink utilities', () => {
  const validPieceLinkString = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
  const invalidCidString = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' // CIDv0, not PieceLink

  describe('asPieceLink', () => {
    it('should accept valid PieceLink string', () => {
      const result = asPieceLink(validPieceLinkString)
      assert.isNotNull(result)
      assert.strictEqual(result?.toString(), validPieceLinkString)
    })

    it('should accept PieceLink CID object', () => {
      const cid = CID.parse(validPieceLinkString)
      const result = asPieceLink(cid)
      assert.isNotNull(result)
      assert.strictEqual(result?.toString(), validPieceLinkString)
    })

    it('should return null for invalid PieceLink string', () => {
      const result = asPieceLink(invalidCidString)
      assert.isNull(result)
    })

    it('should return null for invalid CID object', () => {
      const invalidCid = CID.parse(invalidCidString)
      const result = asPieceLink(invalidCid)
      assert.isNull(result)
    })

    it('should return null for malformed string', () => {
      const result = asPieceLink('not-a-cid')
      assert.isNull(result)
    })

    it('should return null for null input', () => {
      const result = asPieceLink(null as any)
      assert.isNull(result)
    })

    it('should return null for undefined input', () => {
      const result = asPieceLink(undefined as any)
      assert.isNull(result)
    })

    it('should return null for number input', () => {
      const result = asPieceLink(123 as any)
      assert.isNull(result)
    })

    it('should return null for object that is not a CID', () => {
      const result = asPieceLink({} as any)
      assert.isNull(result)
    })
  })

  describe('asLegacyPieceLink', () => {
    zeroPieceLinkFixture.forEach(([size,, v1]) => {
      it('should down-convert PieceLink to LegacyPieceLink', () => {
        const v2 = toPieceLink(BigInt(size), v1)
        const actual = asLegacyPieceLink(v2)
        assert.isNotNull(actual)
        assert.strictEqual(actual.toString(), v1.toString())

        // Round-trip the v1
        const fromV1 = asLegacyPieceLink(v1)
        assert.isNotNull(fromV1)
        assert.strictEqual(fromV1.toString(), v1.toString())

        // Round-trip the v1 as a string
        const fromV1String = asLegacyPieceLink(v1.toString())
        assert.isNotNull(fromV1String)
        assert.strictEqual(fromV1String.toString(), v1.toString())
      })
    })

    it('should return null for invalid LegacyPieceLink string', () => {
      const result = asLegacyPieceLink(invalidCidString)
      assert.isNull(result)
    })

    it('should return null for invalid CID object', () => {
      const invalidCid = CID.parse(invalidCidString)
      const result = asLegacyPieceLink(invalidCid)
      assert.isNull(result)
    })

    it('should return null for malformed string', () => {
      const result = asLegacyPieceLink('not-a-cid')
      assert.isNull(result)
    })

    it('should return null for null input', () => {
      const result = asLegacyPieceLink(null as any)
      assert.isNull(result)
    })

    it('should return null for undefined input', () => {
      const result = asLegacyPieceLink(undefined as any)
      assert.isNull(result)
    })

    it('should return null for number input', () => {
      const result = asLegacyPieceLink(123 as any)
      assert.isNull(result)
    })

    it('should return null for object that is not a CID', () => {
      const result = asLegacyPieceLink({} as any)
      assert.isNull(result)
    })
  })

  // These are not exhaustive tests, but tell us that our use of the upstream
  // PieceLink calculation library and our transformation of the output to CIDs is
  // correct. We'll defer to the upstream library for more detailed tests.
  describe('Calculate PieceLink from fixture data', () => {
    zeroPieceLinkFixture.forEach(([size,, expected]) => {
      it(`should parse PieceLink for size ${size}`, () => {
        // PieceLink for an empty byte array of given size
        const zeroBytes = new Uint8Array(size)
        const result = calculate(zeroBytes)
        assert.isNotNull(result)
        const v2 = toPieceLink(BigInt(size), expected)
        assert.strictEqual(result.toString(), v2.toString())
      })
    })
  })

  describe('createPieceLinkStream', () => {
    it('should calculate same PieceLink as calculate() function', async () => {
      const testData = new Uint8Array(4096).fill(1)

      // Calculate using regular function
      const expectedPieceLink = calculate(testData)

      // Calculate using stream
      const { stream, getPieceLink } = createPieceLinkStream()

      // Create a readable stream from our test data
      const readable = new ReadableStream({
        start (controller) {
          controller.enqueue(testData)
          controller.close()
        }
      })

      // Pipe through PieceLink stream and consume
      const reader = readable.pipeThrough(stream).getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      const streamPieceLink = getPieceLink()
      assert.isNotNull(streamPieceLink)
      assert.strictEqual(streamPieceLink?.toString(), expectedPieceLink.toString())
    })

    it('should handle chunked data correctly', async () => {
      const chunk1 = new Uint8Array([1, 2, 3, 4])
      const chunk2 = new Uint8Array([5, 6, 7, 8])
      const chunk3 = new Uint8Array(1024).fill(1)
      const fullData = new Uint8Array([...chunk1, ...chunk2, ...chunk3])

      // Calculate expected PieceLink
      const expectedPieceLink = calculate(fullData)

      // Calculate using stream with chunks
      const { stream, getPieceLink } = createPieceLinkStream()

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

      const streamPieceLink = getPieceLink()
      assert.isNotNull(streamPieceLink)
      assert.strictEqual(streamPieceLink?.toString(), expectedPieceLink.toString())
    })

    it('should return null before stream is finished', () => {
      const { getPieceLink } = createPieceLinkStream()

      // Should be null before any data
      assert.isNull(getPieceLink())

      // Note: We can't easily test the "during streaming" state without
      // more complex async coordination, so we keep this test simple
    })
  })
})
