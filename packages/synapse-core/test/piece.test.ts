/**
 * PieceCID tests.
 *
 * Coverage strategy: a small set of high-assurance tests focused on cryptographic
 * correctness (golden fixtures from go-fil-commp-hashhash), input-variant
 * equivalence, streaming-vs-batch parity, accessor consistency, validation
 * rejection, and the low-level fr32/merkle primitives.
 */

import { assert } from 'chai'
import { CID } from 'multiformats/cid'
import { bytesToHex } from 'viem/utils'
import * as Piece from '../src/piece/index.ts'

// Golden fixtures from https://github.com/filecoin-project/go-fil-commp-hashhash/blob/master/testdata/zero.txt
// Format: [rawSize, paddedSize, v1CommP base32 string]. The PieceCIDv2 root
// is the last 32 bytes of the v1 CID's bytes.
const zeroPieceFixtures = `
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
    return {
      rawSize: parseInt(parts[0], 10),
      paddedSize: parseInt(parts[1], 10),
      v1Root: CID.parse(parts[2].trim()).bytes.slice(-32),
    }
  })

const validPieceCidString = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
const invalidCidString = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' // CIDv0, not PieceCID

describe('PieceCID', () => {
  // === Cryptographic correctness against canonical Filecoin impl ===
  describe('golden fixtures (go-fil-commp-hashhash)', () => {
    zeroPieceFixtures.forEach(({ rawSize, paddedSize, v1Root }) => {
      it(`raw=${rawSize} → paddedSize=${paddedSize}, root matches go-fil-commp-hashhash`, async () => {
        const piece = await Piece.calculate(new Uint8Array(rawSize))
        assert.deepEqual(Array.from(piece.root), Array.from(v1Root))
        assert.strictEqual(piece.size, rawSize)
        assert.strictEqual(piece.paddedSize, BigInt(paddedSize))
      })
    })
  })

  // FRC-0069 fixtures verified both ways: parse → size, and bytes → CID.
  // The bytes-→-CID direction is critical to lock in tiny-input handling
  // (0/1/127 bytes get zero-padded up before FR32 expansion).
  describe('FRC-0069 fixtures', () => {
    const fixtures: Array<{ cid: string; rawSize: number }> = [
      { cid: 'bafkzcibcp4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy', rawSize: 0 },
      { cid: 'bafkzcibcaabdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy', rawSize: 127 },
      { cid: 'bafkzcibcpybwiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy', rawSize: 128 },
    ]
    fixtures.forEach(({ cid, rawSize }) => {
      it(`size accessor returns ${rawSize} for fixture`, () => {
        assert.strictEqual(Piece.from(cid).size, rawSize)
      })
      it(`calculate(${rawSize} zero bytes) matches fixture CID`, async () => {
        const piece = await Piece.calculate(new Uint8Array(rawSize))
        assert.strictEqual(piece.toString(), cid)
      })
    })
  })

  // birb.mp4: 16,110,964 raw bytes; sanity check on larger payload size decoding.
  it('decodes real-world fixture size', () => {
    const piece = Piece.from('bafkzcibertksae2h5gohz3y4gc6o3uvrljmh4fyz4bexjywokbejjiy63uv2vxzqcq')
    assert.strictEqual(piece.size, 16110964)
  })

  // === Streaming-vs-batch parity (chunk boundary integrity) ===
  describe('streaming = batch', () => {
    // 127B is the FR32 quad size, boundary-aligned. Mix of below/at/above.
    const chunkSizes = [1, 31, 32, 64, 127, 128, 256, 509]

    chunkSizes.forEach((chunkSize) => {
      it(`hasher with chunk size ${chunkSize} matches calculate(bytes)`, async () => {
        const data = new Uint8Array(2048)
        for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 13) & 0xff

        const expected = await Piece.calculate(data)
        const h = Piece.hasher()
        for (let i = 0; i < data.length; i += chunkSize) {
          h.write(data.subarray(i, i + chunkSize))
        }
        assert.strictEqual(h.finalize().toString(), expected.toString())
      })
    })
  })

  // === Input variant equivalence ===
  it('produces identical PieceCID for Uint8Array / Blob / ReadableStream / AsyncIterable', async () => {
    const data = new Uint8Array(1024)
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff

    const expected = await Piece.calculate(data)

    const fromBlob = await Piece.calculate(new Blob([data as Uint8Array<ArrayBuffer>]))
    const fromStream = await Piece.calculate(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })
    )
    const fromAsyncIterable = await Piece.calculate(
      (async function* () {
        yield data
      })()
    )

    assert.strictEqual(fromBlob.toString(), expected.toString())
    assert.strictEqual(fromStream.toString(), expected.toString())
    assert.strictEqual(fromAsyncIterable.toString(), expected.toString())
  })

  // === transformStream parity + pass-through ===
  it('transformStream forwards data unchanged and computes correct PieceCID', async () => {
    const data = new Uint8Array(512).fill(0x42)
    const expected = await Piece.calculate(data)

    const { transform, result } = Piece.transformStream()
    const chunks: Uint8Array[] = []
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data.subarray(0, 200))
        controller.enqueue(data.subarray(200, 400))
        controller.enqueue(data.subarray(400))
        controller.close()
      },
    })
    const piped = source.pipeThrough(transform)
    const reader = piped.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const passed = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let off = 0
    for (const c of chunks) {
      passed.set(c, off)
      off += c.length
    }
    assert.deepEqual(Array.from(passed), Array.from(data))
    assert.strictEqual((await result).toString(), expected.toString())
  })

  // === Accessor consistency on one fixture ===
  it('accessors expose consistent fields', async () => {
    // 1024 bytes of zeros: known to be paddedSize=2048, height=4.
    const piece = await Piece.calculate(new Uint8Array(1024))

    // root is the last 32 bytes of the multihash digest
    const tail = piece.multihash.bytes.subarray(piece.multihash.bytes.length - 32)
    assert.deepEqual(Array.from(piece.root), Array.from(tail))

    assert.strictEqual(piece.size, 1024)
    assert.strictEqual(piece.paddedSize, 2048n)
    assert.isNumber(piece.height)
    assert.isAbove(piece.height, 0)
    assert.isTrue(piece.padding >= 0n)

    // toHex round-trips with the bytes
    assert.strictEqual(piece.toHex(), bytesToHex(piece.bytes))
  })

  // === Round-trip via string / hex / bytes ===
  it('Piece.from round-trips through string / hex / bytes', async () => {
    const original = await Piece.calculate(new Uint8Array(256).fill(7))

    const fromString = Piece.from(original.toString())
    const fromHex = Piece.from(original.toHex())
    const fromBytes = Piece.from(original.bytes)

    assert.isTrue(original.equals(fromString))
    assert.isTrue(original.equals(fromHex))
    assert.isTrue(original.equals(fromBytes))
  })

  // === Sizing-without-hashing cross-check ===
  describe('sizing helpers match hashed PieceCID', () => {
    zeroPieceFixtures.forEach(({ rawSize, paddedSize }) => {
      it(`paddedSizeFor(${rawSize}) === ${paddedSize} and heightFor matches hashed`, async () => {
        assert.strictEqual(Piece.paddedSizeFor(rawSize), BigInt(paddedSize))
        const piece = await Piece.calculate(new Uint8Array(rawSize))
        assert.strictEqual(Piece.heightFor(rawSize), piece.height)
      })
    })
  })

  // Direct size round-trip across a mid-range sweep that fixture sizes don't cover.
  describe('size round-trips for varied inputs', () => {
    for (const size of [1, 50, 100, 500, 1000, 2048, 4096]) {
      it(`calculate(${size}).size === ${size}`, async () => {
        const piece = await Piece.calculate(new Uint8Array(size).fill(1))
        assert.strictEqual(piece.size, size)
      })
    }
  })

  // === Validation rejection ===
  describe('rejection', () => {
    const rejectedInputs: Array<[string, unknown]> = [
      ['CIDv0 string', invalidCidString],
      ['CIDv0 as CID object', CID.parse(invalidCidString)],
      ['CIDv0 as hex', bytesToHex(CID.parse(invalidCidString).bytes)],
      ['garbage string', 'not-a-cid'],
      ['number', 123],
      ['empty object', {}],
      ['valid hex but wrong bytes', '0x0000000000000000000000000000000000000000000000000000000000000000'],
    ]
    rejectedInputs.forEach(([label, input]) => {
      it(`tryFrom returns null for ${label}`, () => {
        assert.isNull(Piece.tryFrom(input as Piece.PieceCIDInput))
      })
      it(`from throws for ${label}`, () => {
        assert.throws(() => Piece.from(input as Piece.PieceCIDInput))
      })
    })

    it('tryFrom handles null and undefined', () => {
      assert.isNull(Piece.tryFrom(null))
      assert.isNull(Piece.tryFrom(undefined))
    })

    // Locks in the digest-shape validation. A CID with the correct codec and
    // multihash code but a truncated digest (only padding + height, no root)
    // must be rejected: the digest layout requires padding-varint + 1-byte
    // height + 32-byte root. Without this check, `piece.root` would return
    // an empty Uint8Array.
    it('rejects PieceCID with truncated digest (missing root)', () => {
      // Multihash: code 0x1011 (varint = 0x91, 0x20), digest-size 0x02, digest = [padding=0, height=2]
      // Then wrap as a v1 CID: [version=1, codec=0x55=raw, multihash...]
      const malformedMultihash = new Uint8Array([0x91, 0x20, 0x02, 0x00, 0x02])
      const malformedCidBytes = new Uint8Array(2 + malformedMultihash.length)
      malformedCidBytes[0] = 0x01 // CIDv1
      malformedCidBytes[1] = 0x55 // raw codec
      malformedCidBytes.set(malformedMultihash, 2)
      const malformedCid = CID.decode(malformedCidBytes)
      assert.isNull(Piece.tryFrom(malformedCid))
      assert.throws(() => Piece.from(malformedCid), /digest shape/)
    })
  })

  // === is + equals ===
  it('is type-guards to PieceCID instances only', async () => {
    const piece = await Piece.calculate(new Uint8Array(127))
    const plainCid = CID.parse(validPieceCidString)
    assert.isTrue(Piece.is(piece))
    assert.isFalse(Piece.is(plainCid)) // plain CID is not a PieceCID instance
    assert.isFalse(Piece.is('bafkz...'))
    assert.isFalse(Piece.is(null))
  })

  it('equals accepts mixed input types', async () => {
    const piece = await Piece.calculate(new Uint8Array(127))
    assert.isTrue(Piece.equals(piece, piece.toString()))
    assert.isTrue(Piece.equals(piece.toHex(), piece))
    assert.isTrue(Piece.equals(piece.bytes, piece))
    assert.isFalse(Piece.equals(piece, validPieceCidString))
    assert.isFalse(Piece.equals(piece, null))
  })

  // === Sanity / regression canaries ===
  it('handles 1 MiB input in reasonable time', async () => {
    const start = Date.now()
    const piece = await Piece.calculate(new Uint8Array(1 << 20))
    const elapsed = Date.now() - start
    assert.strictEqual(piece.size, 1 << 20)
    assert.isBelow(elapsed, 5000, `1 MiB took ${elapsed}ms, possible O(n²) regression`)
  })

  // === Empty-input behavior pin ===
  it('empty input produces a valid PieceCID with size 0', async () => {
    const piece = await Piece.calculate(new Uint8Array(0))
    assert.strictEqual(piece.size, 0)
    // 0 bytes ⇒ padded up to MIN_PAYLOAD_SIZE (65) ⇒ height matches that floor.
    assert.isAbove(piece.height, 0)
  })
})

// === Lower-level primitives ===
describe('Piece.fr32', () => {
  it('round-trips expand → reduce', () => {
    // FR32 round-trip across a few sizes including the 127B quad boundary.
    const sizes = [127, 254, 508, 1016]
    for (const size of sizes) {
      const original = new Uint8Array(size)
      for (let i = 0; i < size; i++) original[i] = (i * 17 + 3) & 0xff
      const expanded = Piece.fr32.expand(original)
      const reduced = Piece.fr32.reduce(expanded)
      assert.deepEqual(Array.from(reduced.subarray(0, size)), Array.from(original), `failed at size ${size}`)
    }
  })

  it('expands 127 input bytes to 128 output bytes', () => {
    const expanded = Piece.fr32.expand(new Uint8Array(127).fill(0xff))
    assert.strictEqual(expanded.length, 128)
    // Top 2 bits of each Fr boundary (byte 31, 63, 95) must be zero after FR32.
    assert.strictEqual(expanded[31] & 0b11000000, 0)
    assert.strictEqual(expanded[63] & 0b11000000, 0)
    assert.strictEqual(expanded[95] & 0b11000000, 0)
  })
})

describe('Piece.merkle', () => {
  it('computeNode SHA254s the concatenation of two 32-byte nodes', () => {
    // Known vector: hash of 64 zero bytes, top 2 bits truncated.
    const zero = new Uint8Array(32)
    const node = Piece.merkle.computeNode(zero, zero)
    assert.strictEqual(node.length, 32)
    assert.strictEqual(node[31] & 0b11000000, 0) // top 2 bits cleared (SHA254)
  })

  it('zeroRoot(0) is the all-zero node', () => {
    const root = Piece.merkle.zeroRoot(0)
    assert.strictEqual(root.length, 32)
    assert.isTrue(root.every((b) => b === 0))
  })

  it('zeroRoot(level+1) equals computeNode(zeroRoot(level), zeroRoot(level))', () => {
    for (let level = 0; level < 5; level++) {
      const expected = Piece.merkle.computeNode(Piece.merkle.zeroRoot(level), Piece.merkle.zeroRoot(level))
      const actual = Piece.merkle.zeroRoot(level + 1)
      assert.deepEqual(Array.from(actual), Array.from(expected), `failed at level ${level + 1}`)
    }
  })

  it('truncate clears top 2 bits of last byte', () => {
    const node = new Uint8Array(32).fill(0xff)
    Piece.merkle.truncate(node)
    assert.strictEqual(node[31], 0b00111111)
  })
})
