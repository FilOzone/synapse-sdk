import assert from 'node:assert'
import { InvalidPlaintextError } from '../src/errors.ts'
import { createChunkFramer, type FramedChunk } from '../src/internal/chunk-framer.ts'

/** Split `data` into consecutive blocks of the given sizes, which must sum to `data.length`. */
function splitInto(data: Uint8Array, sizes: number[]): Uint8Array[] {
  const blocks: Uint8Array[] = []
  let offset = 0
  for (const size of sizes) {
    blocks.push(data.subarray(offset, offset + size))
    offset += size
  }
  assert.strictEqual(offset, data.length, 'test setup: sizes must sum to data.length')
  return blocks
}

/** Copy a chunk's bytes out immediately, per the "valid until next call" contract. */
function copyChunk(chunk: FramedChunk): { bytes: number[]; isLast: boolean } {
  return { bytes: Array.from(chunk.bytes), isLast: chunk.isLast }
}

/** Write every block (as a concurrent producer), close, and pull every chunk out via next(). */
async function frameAll(chunkSize: number, blocks: Uint8Array[]): Promise<{ bytes: number[]; isLast: boolean }[]> {
  const framer = createChunkFramer(chunkSize)
  const writer = framer.writable.getWriter()

  const produce = (async () => {
    for (const block of blocks) {
      await writer.write(block)
    }
    await writer.close()
  })()

  const results: { bytes: number[]; isLast: boolean }[] = []
  for (;;) {
    const chunk = await framer.next()
    results.push(copyChunk(chunk))
    if (chunk.isLast) break
  }
  await produce
  return results
}

describe('createChunkFramer', () => {
  it('yields exactly one empty last chunk for an empty source', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    await writer.close()

    const chunk = await framer.next()
    assert.strictEqual(chunk.bytes.length, 0)
    assert.strictEqual(chunk.isLast, true)
  })

  it('yields a full final chunk for an exact multiple of chunkSize, never an extra empty chunk', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    // A block bigger than chunkSize is held for zero-copy slicing, so the
    // write must not be awaited before the consumer starts pulling.
    const writeDone = writer.write(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))
    const closeDone = writer.close()

    const chunk1 = await framer.next()
    assert.deepStrictEqual(Array.from(chunk1.bytes), [1, 2, 3, 4])
    assert.strictEqual(chunk1.isLast, false)

    const chunk2 = await framer.next()
    assert.deepStrictEqual(Array.from(chunk2.bytes), [5, 6, 7, 8])
    assert.strictEqual(chunk2.isLast, true)

    await writeDone
    await closeDone
  })

  it('yields a partial final chunk', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    await writer.write(Uint8Array.from([1, 2, 3]))
    await writer.close()

    const chunk = await framer.next()
    assert.deepStrictEqual(Array.from(chunk.bytes), [1, 2, 3])
    assert.strictEqual(chunk.isLast, true)
  })

  it('produces identical chunks regardless of how the same plaintext is blocked', async () => {
    const chunkSize = 3
    const data = Uint8Array.from({ length: 10 }, (_, i) => i + 1) // 10 bytes, not a multiple of 3

    const patterns: Uint8Array[][] = [
      splitInto(data, Array(10).fill(1)), // one byte at a time
      [data], // one huge block
      splitInto(data, [2, 4, 1, 3]), // blocks straddling chunk boundaries
      // biome-ignore format: alignment shows the interleaved empty blocks clearly
      [
        data.subarray(0, 0), data.subarray(0, 3), data.subarray(3, 3),
        data.subarray(3, 7), data.subarray(7, 7), data.subarray(7, 10),
      ],
    ]

    const results = await Promise.all(patterns.map((blocks) => frameAll(chunkSize, blocks)))
    for (const result of results.slice(1)) {
      assert.deepStrictEqual(result, results[0])
    }
    // Sanity: not trivially all-empty.
    assert.ok(results[0].length > 1)
  })

  it('holds a block referenced only until its tail is copied, releasing the write lazily', async () => {
    const chunkSize = 4
    const data = Uint8Array.from({ length: 32 }, (_, i) => i + 1) // exactly 8 chunks
    const framer = createChunkFramer(chunkSize)
    const writer = framer.writable.getWriter()

    let writeSettled = false
    const writeDone = writer.write(data).then(() => {
      writeSettled = true
    })
    // Let the sink's write() actually run before next() is called, so this
    // genuinely exercises "block arrives with no consumer waiting yet".
    await new Promise((resolve) => setTimeout(resolve, 0))

    const chunks: number[][] = []
    const firstChunk = await framer.next()
    chunks.push(Array.from(firstChunk.bytes))
    assert.strictEqual(writeSettled, false, 'write must stay pending while a zero-copy view is outstanding')
    assert.strictEqual(
      firstChunk.bytes.buffer,
      data.buffer,
      'a chunk with more block bytes after it must be a zero-copy view, not a copy'
    )

    for (let i = 0; i < 6; i++) {
      chunks.push(Array.from((await framer.next()).bytes))
      assert.strictEqual(writeSettled, false)
    }

    // The 8th pull copies the block's tail into the internal buffer, which
    // releases the block and resolves the write -- before this call settles,
    // since it still needs `close()` to decide the last chunk.
    const eighthPromise = framer.next()
    await writeDone
    assert.strictEqual(writeSettled, true)

    await writer.close()
    const last = await eighthPromise
    chunks.push(Array.from(last.bytes))

    assert.strictEqual(last.isLast, true)
    assert.strictEqual(chunks.length, 8)
    for (let i = 0; i < 8; i++) {
      assert.deepStrictEqual(chunks[i], [i * 4 + 1, i * 4 + 2, i * 4 + 3, i * 4 + 4])
    }
  })

  it('is unaffected by mutating a block after its write() resolves', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    const block = Uint8Array.from([1, 2, 3, 4])
    await writer.write(block)
    block.set([9, 9, 9, 9]) // mutate only after the promise settled
    await writer.close()

    const chunk = await framer.next()
    assert.deepStrictEqual(Array.from(chunk.bytes), [1, 2, 3, 4])
  })

  it("is unaffected by transferring a block's buffer after its write() resolves", async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    const block = Uint8Array.from([5, 6, 7, 8])
    await writer.write(block)
    structuredClone(block.buffer, { transfer: [block.buffer] }) // detaches it
    await writer.close()

    const chunk = await framer.next()
    assert.deepStrictEqual(Array.from(chunk.bytes), [5, 6, 7, 8])
  })

  it('completes a manual write loop against a concurrent consumer without deadlock', async () => {
    const chunkSize = 4
    const framer = createChunkFramer(chunkSize)
    const writer = framer.writable.getWriter()
    const blocks = [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([5, 6, 7, 8]), Uint8Array.from([9, 10, 11, 12])]

    const produce = (async () => {
      for (const block of blocks) {
        await writer.write(block)
      }
      await writer.close()
    })()

    const chunks: { bytes: number[]; isLast: boolean }[] = []
    for (;;) {
      const chunk = await framer.next()
      chunks.push(copyChunk(chunk))
      if (chunk.isLast) break
    }
    await produce

    assert.deepStrictEqual(chunks, [
      { bytes: [1, 2, 3, 4], isLast: false },
      { bytes: [5, 6, 7, 8], isLast: false },
      { bytes: [9, 10, 11, 12], isLast: true },
    ])
  })

  it('rejects a non-Uint8Array block and makes next() reject with the same error', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()

    // @ts-expect-error deliberately passing a non-Uint8Array from untyped JS
    const badWrite = writer.write('not a byte string')
    await assert.rejects(badWrite, InvalidPlaintextError)
    await assert.rejects(framer.next(), InvalidPlaintextError)
  })

  it('rejects a SharedArrayBuffer-backed block and makes next() reject with the same error', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    const view = new Uint8Array(new SharedArrayBuffer(4))

    await assert.rejects(writer.write(view), InvalidPlaintextError)
    await assert.rejects(framer.next(), InvalidPlaintextError)
  })

  it('rejects a pending next() when the writable is aborted', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    const pending = framer.next() // no data yet, so this waits

    const reason = new Error('abort reason')
    await writer.abort(reason)
    await assert.rejects(pending, (err) => err === reason)
  })

  it('does not hang when aborted with an in-flight write and no consumer pulling', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    // Bigger than chunkSize, so this write stays pending without a next() pull,
    // and nobody is calling next() either: writer.abort() must not wait on it.
    const writeDone = writer.write(Uint8Array.from({ length: 20 }, (_, i) => i))
    const reason = new Error('abort reason')

    await writer.abort(reason)
    await assert.rejects(writeDone, (err) => err === reason)
    await assert.rejects(framer.next(), (err) => err === reason)
  })

  it('settles next() after cancel(undefined), instead of hanging on a falsy reason', async () => {
    const framer = createChunkFramer(4)
    const pending = framer.next()
    framer.cancel(undefined)
    await assert.rejects(pending, (err) => err === undefined)
    await assert.rejects(framer.next(), (err) => err === undefined)
  })

  it('settles a pending next() after an unreasoned abort()', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    const pending = framer.next()
    await writer.abort()
    await assert.rejects(pending)
  })

  it('rejects a pending write and errors the writable on cancel', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    // Bigger than chunkSize, so this write stays pending without a next() pull.
    const writeDone = writer.write(Uint8Array.from({ length: 20 }, (_, i) => i))

    const reason = new Error('cancel reason')
    framer.cancel(reason)
    await assert.rejects(writeDone, (err) => err === reason)
    await assert.rejects(writer.write(Uint8Array.from([1])), (err) => err === reason)
  })

  it('settles cleanly when cancelling an idle framer, and next() then rejects', async () => {
    const framer = createChunkFramer(4)
    const reason = new Error('idle cancel')
    assert.doesNotThrow(() => framer.cancel(reason))
    await assert.rejects(framer.next(), (err) => err === reason)
  })

  it('settles cleanly when the writable is aborted while idle', async () => {
    const framer = createChunkFramer(4)
    const writer = framer.writable.getWriter()
    await writer.abort(new Error('idle abort'))
  })
})
