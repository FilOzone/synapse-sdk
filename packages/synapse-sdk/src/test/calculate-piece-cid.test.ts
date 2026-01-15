/**
 * Tests for the unified calculatePieceCID function
 */

import { assert } from 'chai'
import { calculatePieceCID } from '../utils/piece.ts'

describe('calculatePieceCID', () => {
  describe('with Uint8Array input', () => {
    it('should calculate PieceCID for Uint8Array', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const result = await calculatePieceCID(data)

      assert.strictEqual(result.toString(), 'bafkzcibcpibcjvofgtq67muydrg6bunm5jmzpcrqhblwgaivh2gmigjhmqgzqba')
    })

    it('should calculate PieceCID for empty Uint8Array', async () => {
      const data = new Uint8Array(0)
      const result = await calculatePieceCID(data)

      assert.strictEqual(result.toString(), 'bafkzcibcp4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
    })

    it('should calculate PieceCID for large Uint8Array', async () => {
      const data = new Uint8Array(10000).fill(42)
      const result = await calculatePieceCID(data)

      assert.strictEqual(result.toString(), 'bafkzcibd6ayasfjpnqhp6z5psr7vveta4l73ybsyq63cilw7a7tuc3ywn6ju2qq3')
    })
  })

  describe('with AsyncIterable input', () => {
    it('should calculate PieceCID for async generator', async () => {
      const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5])]

      async function* generateChunks() {
        for (const chunk of chunks) {
          yield chunk
        }
      }

      const result = await calculatePieceCID(generateChunks())

      assert.strictEqual(result.toString(), 'bafkzcibcpibcjvofgtq67muydrg6bunm5jmzpcrqhblwgaivh2gmigjhmqgzqba')
    })

    it('should calculate PieceCID for empty async iterable', async () => {
      async function* empty() {
        // yields nothing
      }

      const result = await calculatePieceCID(empty())

      assert.strictEqual(result.toString(), 'bafkzcibcp4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
    })
  })

  describe('input validation', () => {
    const testCases = [
      { input: null, expectedMessage: 'got null' },
      { input: undefined, expectedMessage: 'got undefined' },
      { input: 'hello', expectedMessage: 'got string' },
      { input: 42, expectedMessage: 'got number' },
      { input: {}, expectedMessage: 'missing Symbol.asyncIterator' },
      { input: [1, 2, 3], expectedMessage: 'Invalid input type' },
    ]

    for (const { input, expectedMessage } of testCases) {
      it(`should throw "${expectedMessage}" for input ${JSON.stringify(input)}`, async () => {
        try {
          await calculatePieceCID(input as Uint8Array)
          assert.fail('Expected error to be thrown')
        } catch (error) {
          assert.instanceOf(error, Error)
          assert.include((error as Error).message, 'Invalid input type')
          assert.include((error as Error).message, expectedMessage)
        }
      })
    }
  })
})
