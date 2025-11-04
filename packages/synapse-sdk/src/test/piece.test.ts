/* globals describe it */

/**
 * Basic tests for PieceCID utilities
 */

import type { API } from '@web3-storage/data-segment'
import { Size, toLink } from '@web3-storage/data-segment/piece'
import { assert } from 'chai'
import { ethers } from 'ethers'
import { CID } from 'multiformats/cid'
import {
  asLegacyPieceCID,
  asPieceCID,
  calculate,
  createPieceCIDStream,
  getSizeFromPieceCID,
  type PieceCID,
} from '../piece/index.ts'
import { hexToPieceCID } from '../piece/piece.ts'

// https://github.com/filecoin-project/go-fil-commp-hashhash/blob/master/testdata/zero.txt
const zeroPieceCidFixture = `
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
`
  .trim()
  .split('\n')
  .map((line) => {
    const parts = line.trim().split(',')
    return [parseInt(parts[0], 10), parseInt(parts[1], 10), CID.parse(parts[2].trim())] as [number, number, CID]
  })

function toPieceCID(size: bigint, cid: CID): PieceCID {
  const height = Size.Unpadded.toHeight(size)
  const padding = Size.Unpadded.toPadding(size)
  const root = cid.bytes.slice(-32)
  const piece: API.Piece = { height, root, padding }
  return toLink(piece)
}

describe('PieceCID utilities', () => {
  const validPieceCidString = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
  const invalidCidString = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' // CIDv0, not PieceCID

  describe('asPieceCID', () => {
    it('should accept valid PieceCID string', () => {
      const result = asPieceCID(validPieceCidString)
      assert.isNotNull(result)
      assert.strictEqual(result?.toString(), validPieceCidString)
    })

    it('should accept PieceCID CID object', () => {
      const cid = CID.parse(validPieceCidString)
      const result = asPieceCID(cid)
      assert.isNotNull(result)
      assert.strictEqual(result?.toString(), validPieceCidString)
    })

    it('should return null for invalid PieceCID string', () => {
      const result = asPieceCID(invalidCidString)
      assert.isNull(result)
    })

    it('should return null for invalid CID object', () => {
      const invalidCid = CID.parse(invalidCidString)
      const result = asPieceCID(invalidCid)
      assert.isNull(result)
    })

    it('should return null for malformed string', () => {
      const result = asPieceCID('not-a-cid')
      assert.isNull(result)
    })

    it('should return null for null input', () => {
      const result = asPieceCID(null as any)
      assert.isNull(result)
    })

    it('should return null for undefined input', () => {
      const result = asPieceCID(undefined as any)
      assert.isNull(result)
    })

    it('should return null for number input', () => {
      const result = asPieceCID(123 as any)
      assert.isNull(result)
    })

    it('should return null for object that is not a CID', () => {
      const result = asPieceCID({} as any)
      assert.isNull(result)
    })
  })

  describe('asLegacyPieceCID', () => {
    zeroPieceCidFixture.forEach(([size, , v1]) => {
      it('should down-convert PieceCID to LegacyPieceCID', () => {
        const v2 = toPieceCID(BigInt(size), v1)
        const actual = asLegacyPieceCID(v2)
        assert.isNotNull(actual)
        assert.strictEqual(actual.toString(), v1.toString())

        // Round-trip the v1
        const fromV1 = asLegacyPieceCID(v1)
        assert.isNotNull(fromV1)
        assert.strictEqual(fromV1.toString(), v1.toString())

        // Round-trip the v1 as a string
        const fromV1String = asLegacyPieceCID(v1.toString())
        assert.isNotNull(fromV1String)
        assert.strictEqual(fromV1String.toString(), v1.toString())
      })
    })

    it('should return null for invalid LegacyPieceCID string', () => {
      const result = asLegacyPieceCID(invalidCidString)
      assert.isNull(result)
    })

    it('should return null for invalid CID object', () => {
      const invalidCid = CID.parse(invalidCidString)
      const result = asLegacyPieceCID(invalidCid)
      assert.isNull(result)
    })

    it('should return null for malformed string', () => {
      const result = asLegacyPieceCID('not-a-cid')
      assert.isNull(result)
    })

    it('should return null for null input', () => {
      const result = asLegacyPieceCID(null as any)
      assert.isNull(result)
    })

    it('should return null for undefined input', () => {
      const result = asLegacyPieceCID(undefined as any)
      assert.isNull(result)
    })

    it('should return null for number input', () => {
      const result = asLegacyPieceCID(123 as any)
      assert.isNull(result)
    })

    it('should return null for object that is not a CID', () => {
      const result = asLegacyPieceCID({} as any)
      assert.isNull(result)
    })
  })

  // These are not exhaustive tests, but tell us that our use of the upstream
  // PieceCID calculation library and our transformation of the output to CIDs is
  // correct. We'll defer to the upstream library for more detailed tests.
  describe('Calculate PieceCID from fixture data', () => {
    zeroPieceCidFixture.forEach(([size, , expected]) => {
      it(`should parse PieceCID for size ${size}`, () => {
        // PieceCID for an empty byte array of given size
        const zeroBytes = new Uint8Array(size)
        const result = calculate(zeroBytes)
        assert.isNotNull(result)
        const v2 = toPieceCID(BigInt(size), expected)
        assert.strictEqual(result.toString(), v2.toString())
      })
    })
  })

  describe('createPieceCIDStream', () => {
    it('should calculate same PieceCID as calculate() function', async () => {
      const testData = new Uint8Array(4096).fill(1)

      // Calculate using regular function
      const expectedPieceCid = calculate(testData)

      // Calculate using stream
      const { stream, getPieceCID } = createPieceCIDStream()

      // Create a readable stream from our test data
      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(testData)
          controller.close()
        },
      })

      // Pipe through PieceCID stream and consume
      const reader = readable.pipeThrough(stream).getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      const streamPieceCid = getPieceCID()
      assert.isNotNull(streamPieceCid)
      assert.strictEqual(streamPieceCid?.toString(), expectedPieceCid.toString())
    })

    it('should handle chunked data correctly', async () => {
      const chunk1 = new Uint8Array([1, 2, 3, 4])
      const chunk2 = new Uint8Array([5, 6, 7, 8])
      const chunk3 = new Uint8Array(1024).fill(1)
      const fullData = new Uint8Array([...chunk1, ...chunk2, ...chunk3])

      // Calculate expected PieceCID
      const expectedPieceCid = calculate(fullData)

      // Calculate using stream with chunks
      const { stream, getPieceCID } = createPieceCIDStream()

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk1)
          controller.enqueue(chunk2)
          controller.enqueue(chunk3)
          controller.close()
        },
      })

      const reader = readable.pipeThrough(stream).getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      const streamPieceCid = getPieceCID()
      assert.isNotNull(streamPieceCid)
      assert.strictEqual(streamPieceCid?.toString(), expectedPieceCid.toString())
    })

    it('should return null before stream is finished', () => {
      const { getPieceCID } = createPieceCIDStream()

      // Should be null before any data
      assert.isNull(getPieceCID())

      // Note: We can't easily test the "during streaming" state without
      // more complex async coordination, so we keep this test simple
    })
  })

  describe('getSizeFromPieceCID', () => {
    // Real-world PieceCIDv2 fixtures from FRC-0069 specification
    // These are authoritative test vectors with known sizes
    describe('FRC-0069 specification fixtures', () => {
      const frcFixtures: Array<[string, number]> = [
        // Empty 0-byte payload (127 bytes padding, height 2)
        ['bafkzcibcp4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy', 0],
        // 127 bytes of zeros (0 bytes padding, height 2)
        ['bafkzcibcaabdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy', 127],
        // 128 bytes of zeros (126 bytes padding, height 3)
        ['bafkzcibcpybwiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy', 128],
      ]

      frcFixtures.forEach(([pieceCid, expectedSize]) => {
        it(`should extract size ${expectedSize} from FRC-0069 fixture`, () => {
          const extractedSize = getSizeFromPieceCID(pieceCid)
          assert.strictEqual(extractedSize, expectedSize)
        })
      })
    })

    // birb.mp4, 16110964 bytes
    it('should extract size from real-world fixture', () => {
      const pieceCid = 'bafkzcibertksae2h5gohz3y4gc6o3uvrljmh4fyz4bexjywokbejjiy63uv2vxzqcq'
      const extractedSize = getSizeFromPieceCID(pieceCid)
      assert.strictEqual(extractedSize, 16110964)
    })

    // Use the fixture data which has the format: [rawSize, paddedSize, v1CID]
    // We convert v1CID to v2 PieceCID using the toPieceCID helper
    zeroPieceCidFixture.forEach(([rawSize, , v1]) => {
      it(`should extract raw size ${rawSize} from PieceCID`, () => {
        const v2 = toPieceCID(BigInt(rawSize), v1)
        const extractedSize = getSizeFromPieceCID(v2)
        assert.strictEqual(extractedSize, rawSize)
      })

      it(`should extract raw size ${rawSize} from PieceCID string`, () => {
        const v2 = toPieceCID(BigInt(rawSize), v1)
        const extractedSize = getSizeFromPieceCID(v2.toString())
        assert.strictEqual(extractedSize, rawSize)
      })
    })

    it('should throw for invalid PieceCID string', () => {
      assert.throws(() => {
        getSizeFromPieceCID(invalidCidString)
      }, /Invalid PieceCID/)
    })

    it('should throw for invalid CID object', () => {
      const invalidCid = CID.parse(invalidCidString)
      assert.throws(() => {
        getSizeFromPieceCID(invalidCid)
      }, /Invalid PieceCID/)
    })

    it('should throw for malformed string', () => {
      assert.throws(() => {
        getSizeFromPieceCID('not-a-cid')
      }, /Invalid PieceCID/)
    })

    it('should extract raw size from calculated PieceCID', () => {
      const testData = new Uint8Array(1000).fill(42)
      const pieceCid = calculate(testData)
      const extractedSize = getSizeFromPieceCID(pieceCid)
      assert.strictEqual(extractedSize, testData.length)
    })

    it('should handle various data sizes correctly', () => {
      const testSizes = [1, 50, 100, 127, 128, 500, 1000, 2048, 4096]

      testSizes.forEach((size) => {
        const testData = new Uint8Array(size).fill(1)
        const pieceCid = calculate(testData)
        const extractedSize = getSizeFromPieceCID(pieceCid)
        assert.strictEqual(extractedSize, size, `Failed for size ${size}`)
      })
    })
  })

  describe('hexToPieceCID', () => {
    it('should convert hex to PieceCID', () => {
      zeroPieceCidFixture.forEach(([rawSize]) => {
        // Create the actual PieceCID from raw data
        const zeroBytes = new Uint8Array(rawSize)
        const pieceCid = calculate(zeroBytes)

        // Convert PieceCID to hex (simulating what comes from contract)
        const cidBytes = pieceCid.bytes
        const hex = ethers.hexlify(cidBytes)

        // Use hexToPieceCID to convert back
        const result = hexToPieceCID(hex)

        assert.isNotNull(result)
        assert.strictEqual(result.toString(), pieceCid.toString())
      })
    })

    it('should throw for invalid hex', () => {
      assert.throws(() => {
        hexToPieceCID('not-a-cid')
      }, /invalid BytesLike value/)
    })

    it('should throw for valid hex but invalid CID bytes', () => {
      // Valid hex that ethers.getBytes can parse, but not valid CID structure
      const validHexInvalidCid = '0x0000000000000000000000000000000000000000000000000000000000000000'
      assert.throws(() => {
        hexToPieceCID(validHexInvalidCid)
      }, /Incorrect length/)
    })

    it('should throw for valid cid but invalid PieceCID bytes', () => {
      // Use a CIDv0 which is valid CID but not a valid PieceCID
      // This will pass CID.decode() but fail isValidPieceCID()
      const validCid = CID.parse(invalidCidString)
      const cidBytes = validCid.bytes
      const hex = ethers.hexlify(cidBytes)

      assert.throws(
        () => {
          hexToPieceCID(hex)
        },
        new RegExp(`Hex string '${hex}' is a valid CID but not a valid PieceCID`)
      )
    })
  })
})
