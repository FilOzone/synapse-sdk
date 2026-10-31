import assert from 'assert'
import { encodeAbiParameters, encodeFunctionData, size, toHex, zeroAddress } from 'viem'
import { pdpVerifierAbi } from '../src/abis/generated.ts'
import { InvalidUploadSizeError } from '../src/errors/pdp.ts'
import * as Piece from '../src/piece/index.ts'
import { signAddPiecesAbiParameters } from '../src/typed-data/sign-add-pieces.ts'
import {
  addPiecesFits,
  assertAddPiecesFit,
  assertPieceValid,
  checkAddPiecesFit,
  estimateAddPiecesCalldataSize,
  type LimiterOptions,
  maxFittingPieces,
} from '../src/utils/add-pieces-fits.ts'
import type { MetadataObject } from '../src/utils/metadata.ts'

const pieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
const validSizePieceCid = Piece.from('bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy')
const maxMetadata = { aaa: 'x'.repeat(96), bbb: 'y'.repeat(96), ccc: 'z'.repeat(96) }
const tooLongValue = { name: 'x'.repeat(97) }

/** Reference implementation: try every prefix length. */
function bruteForceMaxFitting(options: LimiterOptions): number {
  let best = 0
  for (let count = 1; count <= options.pieces.length; count++) {
    if (addPiecesFits({ ...options, pieces: options.pieces.slice(0, count) })) {
      best = count
    }
  }
  return best
}

describe('addPiecesFits', () => {
  it('should return false when empty', () => {
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces: [] }), false)
  })

  it('should return true for a single small piece', () => {
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces: [{ pieceCid }] }), true)
  })

  it('should allow more than 40 pieces when they fit the message-size budget', () => {
    const pieces = Array.from({ length: 41 }, () => ({ pieceCid }))
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces }), true)
    assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', pieces }), true)
  })

  it('should enforce the legacy data-set cap', () => {
    const pieces = Array.from({ length: 80 }, () => ({ pieceCid }))
    const legacy = { kind: 'addPieces' as const, dataSetId: 9n, legacyPieceStorageIdLimit: 10n }
    assert.equal(addPiecesFits({ ...legacy, pieces }), true)
    pieces.push({ pieceCid })
    assert.equal(addPiecesFits({ ...legacy, pieces }), false)
    assert.equal(addPiecesFits({ ...legacy, dataSetId: 10n, pieces }), true)
    assert.equal(addPiecesFits({ ...legacy, dataSetId: undefined, pieces }), true)
    assert.equal(addPiecesFits({ ...legacy, legacyPieceStorageIdLimit: undefined, pieces }), true)
    assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', pieces }), true)
  })

  it('should use compact metadata when every piece has none', () => {
    const emptyPieces = Array.from({ length: 2 }, () => ({ pieceCid }))
    const extraData = encodeAbiParameters(signAddPiecesAbiParameters, [0n, [], [], `0x${'00'.repeat(65)}`])
    const expectedCalldata = encodeFunctionData({
      abi: pdpVerifierAbi,
      functionName: 'addPieces',
      args: [0n, zeroAddress, emptyPieces.map((piece) => ({ data: toHex(piece.pieceCid.bytes) })), extraData],
    })

    assert.equal(estimateAddPiecesCalldataSize({ kind: 'addPieces', pieces: emptyPieces }), size(expectedCalldata))
  })

  it('should treat createDataSetAndAddPieces as larger than addPieces', () => {
    const pieces = [{ pieceCid, metadata: { name: 'a', type: 'b' } }]
    const addSize = estimateAddPiecesCalldataSize({ kind: 'addPieces', pieces })
    const createSize = estimateAddPiecesCalldataSize({
      kind: 'createDataSetAndAddPieces',
      metadata: { withCDN: '' },
      cdn: true,
      pieces,
    })
    assert.ok(createSize > addSize)
    assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', pieces }), true)
  })

  it('should eventually reject a list of max-metadata pieces', () => {
    const metadata = {
      aaa: 'x'.repeat(96),
      bbb: 'y'.repeat(96),
      ccc: 'z'.repeat(96),
    }
    let count = 1
    while (
      count < 10_000 &&
      addPiecesFits({
        kind: 'addPieces',
        pieces: Array.from({ length: count }, () => ({ pieceCid, metadata })),
      })
    ) {
      count++
    }
    assert.equal(
      addPiecesFits({
        kind: 'addPieces',
        pieces: Array.from({ length: count }, () => ({ pieceCid, metadata })),
      }),
      false
    )
    assert.ok(count > 1)
    assert.ok(count < 10_000)
  })

  it('should support a custom count limiter', () => {
    const limiter = ({ pieces }: { pieces: unknown[] }) => pieces.length <= 8
    assert.equal(limiter({ pieces: Array.from({ length: 8 }) }), true)
    assert.equal(limiter({ pieces: Array.from({ length: 9 }) }), false)
  })

  it('should return false for invalid piece metadata without throwing', () => {
    const pieces = [{ pieceCid }, { pieceCid, metadata: tooLongValue }]
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces }), false)
    assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', pieces }), false)
    assert.equal(
      addPiecesFits({ kind: 'addPieces', pieces: [{ pieceCid, metadata: { a: '1', b: '2', c: '3', d: '4' } }] }),
      false
    )
    assert.equal(
      addPiecesFits({ kind: 'addPieces', pieces: [{ pieceCid, metadata: { ['k'.repeat(33)]: 'v' } }] }),
      false
    )
  })

  it('should return false for invalid data set metadata without throwing', () => {
    const metadata = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v']))
    assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', metadata, pieces: [{ pieceCid }] }), false)
  })
})

describe('checkAddPiecesFit', () => {
  it('should report fits', () => {
    assert.deepEqual(checkAddPiecesFit({ kind: 'addPieces', pieces: [{ pieceCid }] }), { fits: true })
  })

  it('should report empty', () => {
    assert.deepEqual(checkAddPiecesFit({ kind: 'addPieces', pieces: [] }), { fits: false, reason: 'empty' })
  })

  it('should report legacy-count', () => {
    const pieces = Array.from({ length: 81 }, () => ({ pieceCid }))
    assert.deepEqual(checkAddPiecesFit({ kind: 'addPieces', dataSetId: 1n, legacyPieceStorageIdLimit: 10n, pieces }), {
      fits: false,
      reason: 'legacy-count',
    })
  })

  it('should report too-large', () => {
    const pieces = Array.from({ length: 1000 }, () => ({ pieceCid, metadata: maxMetadata }))
    assert.deepEqual(checkAddPiecesFit({ kind: 'addPieces', pieces }), { fits: false, reason: 'too-large' })
  })

  it('should report the index of the first invalid piece', () => {
    const pieces = [
      { pieceCid },
      { pieceCid, metadata: { a: 'ok' } },
      { pieceCid, metadata: tooLongValue },
      { pieceCid, metadata: tooLongValue },
    ]
    const result = checkAddPiecesFit({ kind: 'addPieces', pieces })
    assert.equal(result.fits, false)
    assert.ok(!result.fits && result.reason === 'invalid-metadata')
    assert.equal(result.index, 2)
    assert.ok(result.cause instanceof Error)
    assert.match(result.cause.message, /value exceeds the maximum length/)
  })

  it('should report invalid data set metadata without an index', () => {
    const result = checkAddPiecesFit({
      kind: 'createDataSetAndAddPieces',
      metadata: { ['k'.repeat(33)]: 'v' },
      pieces: [{ pieceCid }],
    })
    assert.ok(!result.fits && result.reason === 'invalid-metadata')
    assert.equal(result.index, undefined)
    assert.ok(result.cause instanceof Error)
    assert.match(result.cause.message, /key exceeds the maximum length/)
  })
})

describe('assertAddPiecesFit', () => {
  it('should still throw the metadata validation error', () => {
    assert.throws(
      () =>
        assertAddPiecesFit({ kind: 'addPieces', pieces: [{ pieceCid: validSizePieceCid, metadata: tooLongValue }] }),
      /value exceeds the maximum length/
    )
  })
})

describe('assertPieceValid', () => {
  it('should accept a valid piece', () => {
    assertPieceValid({ pieceCid: validSizePieceCid })
    assertPieceValid({ pieceCid: validSizePieceCid, metadata: maxMetadata })
  })

  it('should reject an out-of-range PieceCID size', () => {
    assert.throws(() => assertPieceValid({ pieceCid }), InvalidUploadSizeError)
  })

  it('should reject invalid metadata', () => {
    assert.throws(
      () => assertPieceValid({ pieceCid: validSizePieceCid, metadata: tooLongValue }),
      /value exceeds the maximum length/
    )
    assert.throws(
      () => assertPieceValid({ pieceCid: validSizePieceCid, metadata: { a: '1', b: '2', c: '3', d: '4' } }),
      /maximum number of keys per piece/
    )
  })
})

describe('estimateAddPiecesCalldataSize', () => {
  it('should throw on invalid metadata', () => {
    assert.throws(
      () => estimateAddPiecesCalldataSize({ kind: 'addPieces', pieces: [{ pieceCid, metadata: tooLongValue }] }),
      /value exceeds the maximum length/
    )
  })
})

describe('maxFittingPieces', () => {
  it('should return 0 for no pieces', () => {
    assert.equal(maxFittingPieces({ kind: 'addPieces', pieces: [] }), 0)
  })

  it('should return 0 when the first piece is invalid', () => {
    const pieces = [{ pieceCid, metadata: tooLongValue }, { pieceCid }]
    assert.equal(maxFittingPieces({ kind: 'addPieces', pieces }), 0)
  })

  it('should return 0 when the data set metadata is invalid', () => {
    const metadata = { ['k'.repeat(33)]: 'v' }
    assert.equal(maxFittingPieces({ kind: 'createDataSetAndAddPieces', metadata, pieces: [{ pieceCid }] }), 0)
  })

  it('should return every piece when all fit', () => {
    const pieces = Array.from({ length: 50 }, () => ({ pieceCid }))
    assert.equal(maxFittingPieces({ kind: 'addPieces', pieces }), 50)
    assert.equal(maxFittingPieces({ kind: 'createDataSetAndAddPieces', metadata: { a: 'b' }, cdn: true, pieces }), 50)
  })

  it('should stop before the first invalid piece', () => {
    const pieces = [
      { pieceCid },
      { pieceCid, metadata: { a: 'b' } },
      { pieceCid, metadata: tooLongValue },
      { pieceCid },
    ]
    assert.equal(maxFittingPieces({ kind: 'addPieces', pieces }), 2)
  })

  it('should land exactly on the message-size boundary', () => {
    // About 61 max-metadata pieces fit in one message.
    const pieces = Array.from({ length: 80 }, () => ({ pieceCid, metadata: maxMetadata }))
    const options: LimiterOptions = { kind: 'addPieces', pieces }
    const count = maxFittingPieces(options)
    assert.ok(count > 1 && count < pieces.length)
    assert.equal(addPiecesFits({ ...options, pieces: pieces.slice(0, count) }), true)
    assert.equal(addPiecesFits({ ...options, pieces: pieces.slice(0, count + 1) }), false)
    assert.equal(count, bruteForceMaxFitting(options))
  })

  it('should cap legacy data sets at 80 pieces', () => {
    const pieces = Array.from({ length: 120 }, () => ({ pieceCid }))
    const legacy = { kind: 'addPieces' as const, dataSetId: 9n, legacyPieceStorageIdLimit: 10n }
    assert.equal(maxFittingPieces({ ...legacy, pieces }), 80)
    assert.equal(maxFittingPieces({ ...legacy, pieces: pieces.slice(0, 79) }), 79)
    assert.equal(maxFittingPieces({ ...legacy, dataSetId: 10n, pieces }), 120)
    assert.equal(maxFittingPieces({ ...legacy, pieces }), bruteForceMaxFitting({ ...legacy, pieces }))
  })

  it('should match a brute-force prefix search with mixed metadata', () => {
    const variants: Array<MetadataObject | undefined> = [
      undefined,
      { a: 'b' },
      maxMetadata,
      { name: 'x'.repeat(40) },
      undefined,
      { ipfsRootCID: 'bafy'.padEnd(59, 'a'), label: 'z'.repeat(96) },
    ]
    for (const length of [1, 7, 60, 200]) {
      // Deterministic mix; the first pieces have no metadata so the compact encoding is exercised too.
      const pieces = Array.from({ length }, (_, i) => ({
        pieceCid,
        metadata: i < 3 ? undefined : variants[(i * 7) % variants.length],
      }))
      const cases: LimiterOptions[] = [
        { kind: 'addPieces', pieces },
        { kind: 'addPieces', dataSetId: 1n, legacyPieceStorageIdLimit: 10n, pieces },
        { kind: 'createDataSetAndAddPieces', metadata: { project: 'early-repair' }, cdn: true, pieces },
      ]
      for (const options of cases) {
        assert.equal(maxFittingPieces(options), bruteForceMaxFitting(options), `${options.kind} length=${length}`)
      }
      if (length === 200) {
        // Make sure the size limit, not just the input length, decided the answer.
        assert.ok(maxFittingPieces(cases[0]) < length)
      }
      // An invalid piece truncates the brute-force answer the same way.
      const withInvalid = [...pieces.slice(0, Math.floor(length / 2)), { pieceCid, metadata: tooLongValue }, ...pieces]
      const options: LimiterOptions = { kind: 'addPieces', pieces: withInvalid }
      assert.equal(maxFittingPieces(options), bruteForceMaxFitting(options), `invalid length=${length}`)
    }
  })
})
