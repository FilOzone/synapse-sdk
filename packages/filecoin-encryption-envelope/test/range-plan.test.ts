import assert from 'node:assert'
import { TAG_SIZE } from '../src/constants.ts'
import { InvalidCiphertextLengthError, InvalidRangeError, InvalidSourceLengthError } from '../src/errors.ts'
import { type ChunkedRangeLayoutInput, planRange, type RangePlan } from '../src/range-plan.ts'

const HEADER_LENGTH = 200
const CHUNK_SIZE = 4096
const STRIDE = CHUNK_SIZE + TAG_SIZE

// Object A: partial final chunk. Chunks: [0,4096) [4096,8192) [8192,10000) (1808 B final).
const TOTAL_A = 10000
const LAST_A_PLAINTEXT = TOTAL_A - 2 * CHUNK_SIZE
const CIPHERTEXT_A = STRIDE * 2 + (LAST_A_PLAINTEXT + TAG_SIZE)
const LAYOUT_A: ChunkedRangeLayoutInput = {
  sourceSize: HEADER_LENGTH + CIPHERTEXT_A,
  headerLength: HEADER_LENGTH,
  chunkSize: CHUNK_SIZE,
}

// Object B: exact multiple of the stride. Two full chunks: [0,4096) [4096,8192).
const TOTAL_B = 8192
const CIPHERTEXT_B = STRIDE * 2
const LAYOUT_B: ChunkedRangeLayoutInput = {
  sourceSize: HEADER_LENGTH + CIPHERTEXT_B,
  headerLength: HEADER_LENGTH,
  chunkSize: CHUNK_SIZE,
}

// Object C: a single, partial chunk.
const TOTAL_C = 100
const CIPHERTEXT_C = TOTAL_C + TAG_SIZE
const LAYOUT_C: ChunkedRangeLayoutInput = {
  sourceSize: HEADER_LENGTH + CIPHERTEXT_C,
  headerLength: HEADER_LENGTH,
  chunkSize: CHUNK_SIZE,
}

// Object D: empty. The sole chunk carries a tag and no plaintext.
const CIPHERTEXT_D = TAG_SIZE
const LAYOUT_D: ChunkedRangeLayoutInput = {
  sourceSize: HEADER_LENGTH + CIPHERTEXT_D,
  headerLength: HEADER_LENGTH,
  chunkSize: CHUNK_SIZE,
}

interface Row {
  name: string
  layout: ChunkedRangeLayoutInput
  range: { offset: number; length?: number }
  expected: RangePlan
}

const rows: Row[] = [
  {
    name: 'first bytes',
    layout: LAYOUT_A,
    range: { offset: 0, length: 100 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 100,
      ciphertextSpan: { offset: HEADER_LENGTH, length: STRIDE },
      firstChunk: 0,
      lastChunk: 0,
      chunkCount: 3,
      skip: 0,
      includesFinalChunk: false,
      lastChunkCipherLength: STRIDE,
    },
  },
  {
    name: 'middle of a chunk',
    layout: LAYOUT_A,
    range: { offset: 5000, length: 2000 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 2000,
      ciphertextSpan: { offset: HEADER_LENGTH + STRIDE, length: STRIDE },
      firstChunk: 1,
      lastChunk: 1,
      chunkCount: 3,
      skip: 904,
      includesFinalChunk: false,
      lastChunkCipherLength: STRIDE,
    },
  },
  {
    name: 'exactly one whole chunk',
    layout: LAYOUT_A,
    range: { offset: 0, length: 4096 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 4096,
      ciphertextSpan: { offset: HEADER_LENGTH, length: STRIDE },
      firstChunk: 0,
      lastChunk: 0,
      chunkCount: 3,
      skip: 0,
      includesFinalChunk: false,
      lastChunkCipherLength: STRIDE,
    },
  },
  {
    name: 'crossing one chunk boundary',
    layout: LAYOUT_A,
    range: { offset: 4000, length: 200 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 200,
      ciphertextSpan: { offset: HEADER_LENGTH, length: STRIDE * 2 },
      firstChunk: 0,
      lastChunk: 1,
      chunkCount: 3,
      skip: 4000,
      includesFinalChunk: false,
      lastChunkCipherLength: STRIDE,
    },
  },
  {
    name: 'crossing several chunk boundaries',
    layout: LAYOUT_A,
    range: { offset: 100, length: 9000 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 9000,
      ciphertextSpan: { offset: HEADER_LENGTH, length: CIPHERTEXT_A },
      firstChunk: 0,
      lastChunk: 2,
      chunkCount: 3,
      skip: 100,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'ending exactly at a chunk boundary',
    layout: LAYOUT_A,
    range: { offset: 0, length: 8192 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 8192,
      ciphertextSpan: { offset: HEADER_LENGTH, length: STRIDE * 2 },
      firstChunk: 0,
      lastChunk: 1,
      chunkCount: 3,
      skip: 0,
      includesFinalChunk: false,
      lastChunkCipherLength: STRIDE,
    },
  },
  {
    name: 'the final partial chunk, open-ended',
    layout: LAYOUT_A,
    range: { offset: 8192 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: TOTAL_A - 8192,
      ciphertextSpan: { offset: HEADER_LENGTH + STRIDE * 2, length: LAST_A_PLAINTEXT + TAG_SIZE },
      firstChunk: 2,
      lastChunk: 2,
      chunkCount: 3,
      skip: 0,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'the final full chunk of an exact multiple, open-ended',
    layout: LAYOUT_B,
    range: { offset: 4096 },
    expected: {
      totalPlaintextLength: TOTAL_B,
      rangeLength: TOTAL_B - 4096,
      ciphertextSpan: { offset: HEADER_LENGTH + STRIDE, length: STRIDE },
      firstChunk: 1,
      lastChunk: 1,
      chunkCount: 2,
      skip: 0,
      includesFinalChunk: true,
      lastChunkCipherLength: STRIDE,
    },
  },
  {
    name: 'the whole object',
    layout: LAYOUT_A,
    range: { offset: 0 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: TOTAL_A,
      ciphertextSpan: { offset: HEADER_LENGTH, length: CIPHERTEXT_A },
      firstChunk: 0,
      lastChunk: 2,
      chunkCount: 3,
      skip: 0,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'a declared plaintextLength matching the derived layout is accepted',
    layout: { ...LAYOUT_A, plaintextLength: TOTAL_A },
    range: { offset: 0 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: TOTAL_A,
      ciphertextSpan: { offset: HEADER_LENGTH, length: CIPHERTEXT_A },
      firstChunk: 0,
      lastChunk: 2,
      chunkCount: 3,
      skip: 0,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'open-ended from the middle',
    layout: LAYOUT_A,
    range: { offset: 5000 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: TOTAL_A - 5000,
      ciphertextSpan: { offset: HEADER_LENGTH + STRIDE, length: CIPHERTEXT_A - STRIDE },
      firstChunk: 1,
      lastChunk: 2,
      chunkCount: 3,
      skip: 904,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'a suffix inside the final chunk',
    layout: LAYOUT_A,
    range: { offset: -500 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 500,
      ciphertextSpan: { offset: HEADER_LENGTH + STRIDE * 2, length: LAST_A_PLAINTEXT + TAG_SIZE },
      firstChunk: 2,
      lastChunk: 2,
      chunkCount: 3,
      skip: 1308,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'a suffix crossing chunk boundaries',
    layout: LAYOUT_A,
    range: { offset: -5000 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 5000,
      ciphertextSpan: { offset: HEADER_LENGTH + STRIDE, length: CIPHERTEXT_A - STRIDE },
      firstChunk: 1,
      lastChunk: 2,
      chunkCount: 3,
      skip: 904,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'a suffix longer than the object clamps to the whole object',
    layout: LAYOUT_A,
    range: { offset: -999999 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: TOTAL_A,
      ciphertextSpan: { offset: HEADER_LENGTH, length: CIPHERTEXT_A },
      firstChunk: 0,
      lastChunk: 2,
      chunkCount: 3,
      skip: 0,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'the end clamps past EOF',
    layout: LAYOUT_A,
    range: { offset: 9000, length: 5000 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: TOTAL_A - 9000,
      ciphertextSpan: { offset: HEADER_LENGTH + STRIDE * 2, length: LAST_A_PLAINTEXT + TAG_SIZE },
      firstChunk: 2,
      lastChunk: 2,
      chunkCount: 3,
      skip: 808,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'offset = total - 1',
    layout: LAYOUT_A,
    range: { offset: TOTAL_A - 1 },
    expected: {
      totalPlaintextLength: TOTAL_A,
      rangeLength: 1,
      ciphertextSpan: { offset: HEADER_LENGTH + STRIDE * 2, length: LAST_A_PLAINTEXT + TAG_SIZE },
      firstChunk: 2,
      lastChunk: 2,
      chunkCount: 3,
      skip: LAST_A_PLAINTEXT - 1,
      includesFinalChunk: true,
      lastChunkCipherLength: LAST_A_PLAINTEXT + TAG_SIZE,
    },
  },
  {
    name: 'a range entirely inside a single-chunk object',
    layout: LAYOUT_C,
    range: { offset: 10, length: 50 },
    expected: {
      totalPlaintextLength: TOTAL_C,
      rangeLength: 50,
      ciphertextSpan: { offset: HEADER_LENGTH, length: CIPHERTEXT_C },
      firstChunk: 0,
      lastChunk: 0,
      chunkCount: 1,
      skip: 10,
      includesFinalChunk: true,
      lastChunkCipherLength: CIPHERTEXT_C,
    },
  },
]

describe('planRange', () => {
  it('reads offset and length once, so a getter cannot change them after validation', () => {
    let offsetReads = 0
    let lengthReads = 0
    const range = {
      get offset() {
        return offsetReads++ === 0 ? 10 : Number.NaN
      },
      get length() {
        return lengthReads++ === 0 ? 20 : Number.NaN
      },
    }
    const plan = planRange({ sourceSize: 10000, headerLength: 0, chunkSize: 4096 }, range)
    assert.strictEqual(offsetReads, 1)
    assert.strictEqual(lengthReads, 1)
    assert.strictEqual(plan.rangeLength, 20)
    assert.strictEqual(plan.skip, 10)
  })

  describe('table', () => {
    for (const { name, layout, range, expected } of rows) {
      it(name, () => {
        assert.deepStrictEqual(planRange(layout, range), expected)
      })
    }
  })

  describe('rejections', () => {
    it('rejects every range shape against an empty object', () => {
      for (const range of [{ offset: 0 }, { offset: 0, length: 10 }, { offset: -10 }]) {
        assert.throws(() => planRange(LAYOUT_D, range), InvalidRangeError)
      }
    })

    it('rejects length: 0', () => {
      assert.throws(() => planRange(LAYOUT_A, { offset: 0, length: 0 }), InvalidRangeError)
    })

    it('rejects a negative length', () => {
      assert.throws(() => planRange(LAYOUT_A, { offset: 0, length: -5 }), InvalidRangeError)
    })

    it('rejects offset === total', () => {
      assert.throws(() => planRange(LAYOUT_A, { offset: TOTAL_A }), InvalidRangeError)
    })

    it('rejects offset > total', () => {
      assert.throws(() => planRange(LAYOUT_A, { offset: TOTAL_A + 1 }), InvalidRangeError)
    })

    const badNumbers: Array<[string, number]> = [
      ['1.5', 1.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['2**53', 2 ** 53],
    ]
    for (const [label, value] of badNumbers) {
      it(`rejects an offset of ${label}`, () => {
        assert.throws(() => planRange(LAYOUT_A, { offset: value }), InvalidRangeError)
      })
      it(`rejects a length of ${label}`, () => {
        assert.throws(() => planRange(LAYOUT_A, { offset: 0, length: value }), InvalidRangeError)
      })
    }

    it('rejects a suffix range that also specifies a length', () => {
      assert.throws(() => planRange(LAYOUT_A, { offset: -10, length: 5 }), InvalidRangeError)
    })

    const nonObjectRanges: Array<[string, unknown]> = [
      ['null', null],
      ['a number', 5],
      ['a string', 'nope'],
      ['undefined', undefined],
      ['an array', [0, 10]],
    ]
    for (const [label, range] of nonObjectRanges) {
      it(`rejects ${label} as a range`, () => {
        assert.throws(() => planRange(LAYOUT_A, range), InvalidRangeError)
      })
    }

    it('rejects sourceSize < headerLength', () => {
      assert.throws(
        () => planRange({ sourceSize: 100, headerLength: 200, chunkSize: CHUNK_SIZE }, { offset: 0 }),
        InvalidSourceLengthError
      )
    })

    it('rejects an impossible ciphertext length (remainder below the tag size)', () => {
      const layout: ChunkedRangeLayoutInput = {
        sourceSize: HEADER_LENGTH + STRIDE + 5,
        headerLength: HEADER_LENGTH,
        chunkSize: CHUNK_SIZE,
      }
      assert.throws(() => planRange(layout, { offset: 0 }), InvalidCiphertextLengthError)
    })

    it('rejects a plaintextLength that disagrees with the derived layout', () => {
      const layout: ChunkedRangeLayoutInput = { ...LAYOUT_A, plaintextLength: TOTAL_A - 1 }
      assert.throws(() => planRange(layout, { offset: 0 }), InvalidCiphertextLengthError)
    })
  })

  describe('independent oracle', () => {
    // A small object at the minimum chunk size: 3 chunks (2 full, one partial final chunk).
    const chunkSize = CHUNK_SIZE
    const headerLength = 50
    const total = 9000
    const chunkCount = Math.ceil(total / chunkSize)
    const lastChunkPlaintext = total - (chunkCount - 1) * chunkSize
    const ciphertextLength = (chunkCount - 1) * (chunkSize + TAG_SIZE) + (lastChunkPlaintext + TAG_SIZE)
    const layout: ChunkedRangeLayoutInput = { sourceSize: headerLength + ciphertextLength, headerLength, chunkSize }

    /** Never uses planRange's own formulas: walks every chunk and keeps the ones overlapping [start, end). */
    function naivePlan(offset: number, length?: number): RangePlan {
      let start: number
      let end: number
      if (offset < 0) {
        start = Math.max(0, total + offset)
        end = total
      } else {
        start = offset
        end = total
        if (length !== undefined && offset + length < end) {
          end = offset + length
        }
      }

      let firstChunk = -1
      let lastChunk = -1
      let cumulativeOffset = headerLength
      let spanOffset = -1
      let spanEnd = -1
      let lastChunkCipherLength = 0
      for (let i = 0; i < chunkCount; i++) {
        const chunkStart = i * chunkSize
        const chunkEnd = Math.min(chunkStart + chunkSize, total)
        const isFinal = i === chunkCount - 1
        const cipherLength = isFinal ? lastChunkPlaintext + TAG_SIZE : chunkSize + TAG_SIZE
        if (chunkStart < end && chunkEnd > start) {
          if (firstChunk === -1) {
            firstChunk = i
            spanOffset = cumulativeOffset
          }
          lastChunk = i
          spanEnd = cumulativeOffset + cipherLength
          lastChunkCipherLength = cipherLength
        }
        cumulativeOffset += cipherLength
      }

      return {
        totalPlaintextLength: total,
        rangeLength: end - start,
        ciphertextSpan: { offset: spanOffset, length: spanEnd - spanOffset },
        firstChunk,
        lastChunk,
        chunkCount,
        skip: start - firstChunk * chunkSize,
        includesFinalChunk: lastChunk === chunkCount - 1,
        lastChunkCipherLength,
      }
    }

    it('matches a chunk-by-chunk walk across many offsets, lengths, and suffixes', () => {
      for (let offset = 0; offset < total; offset++) {
        for (const length of [undefined, 1, 3, total, total + 1000]) {
          assert.deepStrictEqual(
            planRange(layout, { offset, length }),
            naivePlan(offset, length),
            `offset=${offset} length=${length}`
          )
        }
      }
      for (let suffix = 1; suffix <= total; suffix++) {
        assert.deepStrictEqual(planRange(layout, { offset: -suffix }), naivePlan(-suffix), `suffix=-${suffix}`)
      }
      for (const suffix of [total + 1, total + 100, 10000]) {
        assert.deepStrictEqual(planRange(layout, { offset: -suffix }), naivePlan(-suffix), `suffix=-${suffix}`)
      }
    })
  })
})
