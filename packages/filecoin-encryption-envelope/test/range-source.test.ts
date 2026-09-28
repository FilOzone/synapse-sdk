import assert from 'node:assert'
import { type ChunkedEncryptOptions, encrypt } from '../src/aes-gcm-stream.ts'
import { MAX_ENCODED_OBJECT_SIZE } from '../src/constants.ts'
import { MAX_ENVELOPE_SIZE } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { InvalidSourceLengthError, MalformedEnvelopeError } from '../src/errors.ts'
import { openExactRange, type RandomAccessSource, readEnvelope, toRandomAccessSource } from '../src/range/source.ts'
import { FIXED_CEK, fixedBaseNonceRandomValues, withRandomValues } from './aes-gcm-fixtures.ts'
import { deterministicPlaintext, readAllChunks, sourceOf } from './aes-gcm-stream-fixtures.ts'
import { concatBytes } from './cose-fixtures.ts'

/** Encrypt via the production writer and drive it to completion. */
async function encryptFull(plaintext: Uint8Array, extra: Partial<ChunkedEncryptOptions> = {}): Promise<Uint8Array> {
  const { writable, readable } = await withRandomValues(fixedBaseNonceRandomValues, async () =>
    encrypt({ cek: new Uint8Array(FIXED_CEK), ...extra })
  )
  const writer = writable.getWriter()
  const writeDone = writer.write(plaintext)
  const closeDone = writer.close()
  const chunks = await readAllChunks(readable)
  await writeDone
  await closeDone
  return concatBytes(...chunks)
}

/** An object whose envelope alone (large `app_metadata`) is bigger than 12288 bytes. */
async function encryptBigEnvelope(): Promise<Uint8Array> {
  return encryptFull(Uint8Array.from([1, 2, 3]), { appMetadata: { note: 'x'.repeat(14800) } })
}

describe('toRandomAccessSource', () => {
  describe('Uint8Array adapter', () => {
    it('reports size and returns the exact requested range', async () => {
      const bytes = deterministicPlaintext(50)
      const source = toRandomAccessSource(bytes)
      assert.strictEqual(source.size, 50)
      const stream = await source.openRange(10, 5)
      const chunks = await readAllChunks(stream)
      assert.deepStrictEqual(concatBytes(...chunks), bytes.subarray(10, 15))
    })

    it('the returned view shares the input buffer (no copy)', async () => {
      const bytes = deterministicPlaintext(20)
      const source = toRandomAccessSource(bytes)
      const stream = await source.openRange(0, 20)
      const [chunk] = await readAllChunks(stream)
      assert.strictEqual(chunk.buffer, bytes.buffer)
    })

    it('rejects a SharedArrayBuffer-backed input', () => {
      const shared = new Uint8Array(new SharedArrayBuffer(10))
      assert.throws(() => toRandomAccessSource(shared), MalformedEnvelopeError)
    })
  })

  describe('object adapter', () => {
    it('captures size and forwards openRange calls', async () => {
      let calls = 0
      const raw = {
        size: 42,
        async openRange(offset: number, length: number) {
          calls++
          return sourceOf([Uint8Array.from({ length }, (_, i) => offset + i)])
        },
      }
      const source = toRandomAccessSource(raw)
      assert.strictEqual(source.size, 42)
      const stream = await source.openRange(1, 3)
      assert.deepStrictEqual(concatBytes(...(await readAllChunks(stream))), Uint8Array.from([1, 2, 3]))
      assert.strictEqual(calls, 1)
    })

    it('reads size and openRange exactly once from the input object, even across several openRange calls', async () => {
      let sizeReads = 0
      let openRangeReads = 0
      const raw = {
        get size() {
          sizeReads++
          return 10
        },
        get openRange() {
          openRangeReads++
          return async () => sourceOf([])
        },
      }
      const source = toRandomAccessSource(raw)
      assert.strictEqual(sizeReads, 1)
      assert.strictEqual(openRangeReads, 1)

      // The getter must not be re-consulted on later calls through the
      // adapter: only the function reference captured at construction runs.
      await source.openRange(0, 1)
      await source.openRange(1, 2)
      assert.strictEqual(openRangeReads, 1)
    })
  })

  describe('size validation', () => {
    const invalidSizes: Array<[string, unknown]> = [
      ['negative', -1],
      ['non-integer', 1.5],
      ['NaN', Number.NaN],
      ['2**53 (not a safe integer)', 2 ** 53],
      ['one over the max', MAX_ENCODED_OBJECT_SIZE + 1],
    ]
    for (const [label, size] of invalidSizes) {
      it(`rejects a size that is ${label}`, () => {
        assert.throws(
          () => toRandomAccessSource({ size, openRange: async () => sourceOf([]) }),
          InvalidSourceLengthError
        )
      })
    }

    it('accepts exactly the max size', () => {
      const source = toRandomAccessSource({ size: MAX_ENCODED_OBJECT_SIZE, openRange: async () => sourceOf([]) })
      assert.strictEqual(source.size, MAX_ENCODED_OBJECT_SIZE)
    })
  })

  describe('malformed input', () => {
    it('rejects a non-function openRange', () => {
      assert.throws(() => toRandomAccessSource({ size: 10, openRange: 'nope' }), MalformedEnvelopeError)
    })

    const nonSources: Array<[string, unknown, typeof MalformedEnvelopeError | typeof InvalidSourceLengthError]> = [
      ['null', null, MalformedEnvelopeError],
      ['a number', 5, MalformedEnvelopeError],
      ['a string', 'nope', MalformedEnvelopeError],
      ['undefined', undefined, MalformedEnvelopeError],
      // An array is `typeof 'object'` but has no `size`, so it fails size
      // validation instead of the "not an object" check.
      ['an array', [1, 2, 3], InvalidSourceLengthError],
    ]
    for (const [label, input, expected] of nonSources) {
      it(`rejects ${label} as a source`, () => {
        assert.throws(() => toRandomAccessSource(input), expected)
      })
    }
  })
})

describe('openExactRange', () => {
  it('cancel does not wait for a pending openRange, and cancels its stream once it arrives', async () => {
    let resolveOpen: ((stream: ReadableStream<Uint8Array>) => void) | undefined
    let signalOpenCalled: (() => void) | undefined
    const openCalled = new Promise<void>((resolve) => {
      signalOpenCalled = resolve
    })
    const source: RandomAccessSource = {
      size: 100,
      openRange: () =>
        new Promise((resolve) => {
          resolveOpen = resolve
          signalOpenCalled?.()
        }),
    }
    const range = openExactRange(source, 0, 10)
    const pendingRead = range.read()
    await openCalled // openRange is now pending

    await range.cancel(new Error('stop')) // must settle while the open hangs

    let signalLateCancel: (() => void) | undefined
    const lateCancelled = new Promise<void>((resolve) => {
      signalLateCancel = resolve
    })
    resolveOpen?.(
      new ReadableStream<Uint8Array>({
        cancel() {
          signalLateCancel?.()
        },
      })
    )
    await lateCancelled // the late stream is released, not leaked
    // The read that was waiting on the open ends too, instead of hanging.
    await assert.rejects(pendingRead, InvalidSourceLengthError)
  })

  function sourceReturning(
    blocks: Uint8Array[],
    openRangeOverride?: (offset: number, length: number) => Promise<ReadableStream<Uint8Array>>
  ): RandomAccessSource {
    return {
      size: 1000,
      openRange: openRangeOverride ?? (async () => sourceOf(blocks)),
    }
  }

  it('reads a single-block exact range', async () => {
    const data = deterministicPlaintext(10)
    const range = openExactRange(sourceReturning([data]), 0, 10)
    assert.deepStrictEqual(await range.read(), data)
    assert.strictEqual(await range.read(), undefined)
  })

  it('reads a multi-block exact range', async () => {
    const a = deterministicPlaintext(4)
    const b = Uint8Array.from([9, 9, 9, 9, 9, 9])
    const range = openExactRange(sourceReturning([a, b]), 0, 10)
    assert.deepStrictEqual(await range.read(), a)
    assert.deepStrictEqual(await range.read(), b)
    assert.strictEqual(await range.read(), undefined)
  })

  it('skips zero-length blocks', async () => {
    const data = deterministicPlaintext(5)
    const range = openExactRange(sourceReturning([new Uint8Array(0), data, new Uint8Array(0)]), 0, 5)
    assert.deepStrictEqual(await range.read(), data)
    assert.strictEqual(await range.read(), undefined)
  })

  it('rejects a short range once the underlying stream ends early', async () => {
    const range = openExactRange(sourceReturning([deterministicPlaintext(3)]), 0, 10)
    await range.read()
    await assert.rejects(range.read(), InvalidSourceLengthError)
  })

  it('rejects a single block longer than the requested length', async () => {
    const range = openExactRange(sourceReturning([deterministicPlaintext(20)]), 0, 10)
    await assert.rejects(range.read(), InvalidSourceLengthError)
  })

  it('rejects a trailing block after the exact count', async () => {
    const range = openExactRange(sourceReturning([deterministicPlaintext(10), Uint8Array.from([1])]), 0, 10)
    await range.read()
    await assert.rejects(range.read(), InvalidSourceLengthError)
  })

  it('rejects a zero-length block followed by more data after the exact count', async () => {
    const range = openExactRange(
      sourceReturning([deterministicPlaintext(10), new Uint8Array(0), Uint8Array.from([1])]),
      0,
      10
    )
    await range.read()
    await assert.rejects(range.read(), InvalidSourceLengthError)
  })

  it('rejects a non-Uint8Array block', async () => {
    const range = openExactRange(
      sourceReturning(
        [],
        async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue('nope' as unknown as Uint8Array)
              controller.close()
            },
          })
      ),
      0,
      3
    )
    await assert.rejects(range.read(), MalformedEnvelopeError)
  })

  it('rejects openRange resolving to a non-stream', async () => {
    const range = openExactRange(
      sourceReturning([], async () => 'nope' as unknown as ReadableStream<Uint8Array>),
      0,
      3
    )
    await assert.rejects(range.read(), MalformedEnvelopeError)
  })

  it('propagates an openRange rejection unchanged', async () => {
    const boom = new Error('transport boom')
    const range = openExactRange(
      sourceReturning([], () => Promise.reject(boom)),
      0,
      3
    )
    await assert.rejects(range.read(), (error: unknown) => error === boom)
  })

  it('calls openRange at most once', async () => {
    let calls = 0
    const range = openExactRange(
      sourceReturning([deterministicPlaintext(4), deterministicPlaintext(4)], async () => {
        calls++
        return sourceOf([deterministicPlaintext(8)])
      }),
      0,
      8
    )
    await range.read()
    await range.read()
    assert.strictEqual(calls, 1)
  })

  /** A pull-driven source stream that records cancellation; `blocks` are served one per pull. */
  function trackedStream(blocks: Uint8Array[]): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
    let cancelled = false
    let index = 0
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const block = blocks[index++]
          if (block === undefined) controller.close()
          else controller.enqueue(block)
        },
        cancel() {
          cancelled = true
        },
      },
      { highWaterMark: 0 }
    )
    return { stream, cancelled: () => cancelled }
  }

  it('cancels the source stream when a block overruns the requested length', async () => {
    const tracked = trackedStream([new Uint8Array(4), new Uint8Array(8), new Uint8Array(4)])
    const range = openExactRange(
      sourceReturning([], async () => tracked.stream),
      0,
      10
    )
    await range.read()
    await assert.rejects(range.read(), InvalidSourceLengthError)
    assert.strictEqual(tracked.cancelled(), true)
  })

  it('cancels the source stream when bytes follow the requested length', async () => {
    const tracked = trackedStream([new Uint8Array(10), new Uint8Array(1), new Uint8Array(1)])
    const range = openExactRange(
      sourceReturning([], async () => tracked.stream),
      0,
      10
    )
    await range.read()
    await assert.rejects(range.read(), InvalidSourceLengthError)
    assert.strictEqual(tracked.cancelled(), true)
  })

  it('cancel is a no-op before any read()', async () => {
    const range = openExactRange(sourceReturning([deterministicPlaintext(5)]), 0, 5)
    await assert.doesNotReject(range.cancel(new Error('unused')))
  })

  it('cancel cancels the underlying reader', async () => {
    let cancelReason: unknown
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(deterministicPlaintext(5))
        // Left open: the range is never fully drained naturally.
      },
      cancel(reason) {
        cancelReason = reason
      },
    })
    const range = openExactRange(
      sourceReturning([], async () => stream),
      0,
      10
    )
    await range.read()
    const reason = new Error('stop early')
    await range.cancel(reason)
    assert.strictEqual(cancelReason, reason)
  })
})

describe('readEnvelope', () => {
  function recordingSource(bytes: Uint8Array): {
    source: RandomAccessSource
    calls: Array<{ offset: number; length: number }>
    cancelled: Array<{ offset: number; length: number }>
  } {
    const calls: Array<{ offset: number; length: number }> = []
    const cancelled: Array<{ offset: number; length: number }> = []
    // Delivered in small blocks, closing only on a *later* pull() once
    // fully drained -- like a real transport, so a span that completes the
    // envelope partway through still has bytes left to actually cancel.
    const blockSize = 64
    const source: RandomAccessSource = {
      size: bytes.length,
      async openRange(offset, length) {
        calls.push({ offset, length })
        const slice = bytes.subarray(offset, offset + length)
        let pos = 0
        return new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (pos >= slice.length) {
                controller.close()
                return
              }
              const end = Math.min(pos + blockSize, slice.length)
              controller.enqueue(slice.subarray(pos, end))
              pos = end
            },
            cancel() {
              cancelled.push({ offset, length })
            },
          },
          // Without this, the default queuing strategy (highWaterMark: 1)
          // eagerly pulls one block ahead of every explicit read() -- which
          // would call pull() again (and self-close) right after the block
          // that completes the envelope, before this test ever cancels it.
          { highWaterMark: 0 }
        )
      },
    }
    return { source, calls, cancelled }
  }

  it('probes exactly one span [0, min(4096, size)) for a small envelope', async () => {
    const full = await encryptFull(deterministicPlaintext(10))
    const { source, calls } = recordingSource(full)
    const decoded = await readEnvelope(source)
    assert.deepStrictEqual(calls, [{ offset: 0, length: Math.min(4096, full.length) }])
    assert.deepStrictEqual(decoded, decodeEnvelope(full))
  })

  it('probes contiguous, doubling spans for an envelope larger than 4096 bytes, never re-reading offset 0', async () => {
    const full = await encryptBigEnvelope()
    const { source, calls, cancelled } = recordingSource(full)
    const decoded = await readEnvelope(source)

    assert.deepStrictEqual(
      calls.map((call) => call.offset),
      [0, 4096, 12288]
    )
    assert.deepStrictEqual(calls[0], { offset: 0, length: 4096 })
    assert.deepStrictEqual(calls[1], { offset: 4096, length: 8192 })
    assert.strictEqual(calls[2].offset, 12288)
    for (const call of calls) {
      assert.ok(call.offset + call.length <= full.length, 'never reads past the source size')
      assert.ok(call.offset + call.length <= MAX_ENVELOPE_SIZE, 'never reads past the 1 MiB envelope limit')
    }
    assert.deepStrictEqual(decoded, decodeEnvelope(full))
    // The span that completed the envelope is cancelled, not drained.
    assert.deepStrictEqual(cancelled, [calls[2]])
  })

  it('probes exactly `size` when smaller than 4096', async () => {
    const full = await encryptFull(deterministicPlaintext(2))
    assert.ok(full.length < 4096)
    const { source, calls } = recordingSource(full)
    await readEnvelope(source)
    assert.deepStrictEqual(calls, [{ offset: 0, length: full.length }])
  })

  it('rejects bytes ending inside the envelope with MalformedEnvelopeError', async () => {
    const full = await encryptBigEnvelope()
    const envelopeLength = decodeEnvelope(full).envelopeLength
    const truncated = full.subarray(0, envelopeLength - 5)
    const { source } = recordingSource(truncated)
    await assert.rejects(readEnvelope(source), MalformedEnvelopeError)
  })

  it('behaves the same for size === 0', async () => {
    const source: RandomAccessSource = {
      size: 0,
      async openRange() {
        return sourceOf([])
      },
    }
    await assert.rejects(readEnvelope(source), MalformedEnvelopeError)
  })

  it('fails fast on non-FEE bytes, with no further openRange calls', async () => {
    // 0xff: major 7, additional info 31 -- rejected immediately as an
    // indefinite-length/break marker, before any more input is requested.
    const garbage = new Uint8Array(5000).fill(0xff)
    const { source, calls, cancelled } = recordingSource(garbage)
    await assert.rejects(readEnvelope(source), MalformedEnvelopeError)
    assert.strictEqual(calls.length, 1)
    // The failing span is released, not left open.
    assert.deepStrictEqual(cancelled, [calls[0]])
  })

  it('rejects a source returning a short first span with InvalidSourceLengthError', async () => {
    const full = await encryptBigEnvelope()
    const source: RandomAccessSource = {
      size: full.length,
      async openRange(offset, length) {
        // Always one byte short of what was requested.
        return sourceOf([full.subarray(offset, offset + length - 1)])
      },
    }
    await assert.rejects(readEnvelope(source), InvalidSourceLengthError)
  })
})
