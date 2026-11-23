import { rejects } from 'assert'
import { assert } from 'chai'
import { HttpError } from 'iso-web/http'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { DownloadPieceError } from '../src/errors/pdp.ts'
import { ProviderError } from '../src/errors/provider.ts'
import { downloadAndValidate, downloadStream } from '../src/piece/download.ts'
import * as Piece from '../src/piece/index.ts'
import { readAllBytes } from '../src/utils/streams.ts'

describe('DownloadPieceError', () => {
  it('keeps the one-argument constructor working', () => {
    const error = new DownloadPieceError('boom')
    assert.equal(error.details, 'boom')
    assert.isUndefined(error.reason)
    assert.isUndefined(error.status)
    assert.isFalse(error.notFound)
    assert.isFalse(error.verificationFailed)
    assert.isTrue(DownloadPieceError.is(error))
  })

  it('is a ProviderError and defaults the reason to http when a status is given', () => {
    const error = new DownloadPieceError('boom', { status: 503 })
    assert.isTrue(ProviderError.is(error))
    assert.equal(error.reason, 'http')
    assert.equal(error.toJSON().status, 503)
    assert.equal(new DownloadPieceError('boom', { status: 404, reason: 'empty' }).reason, 'empty')
  })

  it('serializes the reason and notFound', () => {
    const json = new DownloadPieceError('PieceCID verification failed', { reason: 'mismatch' }).toJSON()
    assert.equal(json.reason, 'mismatch')
    assert.equal(json.notFound, false)
    assert.isTrue(new DownloadPieceError('Not Found', { status: 404 }).toJSON().notFound)
    assert.notProperty(new DownloadPieceError('boom').toJSON(), 'reason')
  })
})

describe('Piece download and validation', () => {
  const server = setup()

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('downloadAndValidate', () => {
    it('should successfully download and verify piece', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = await Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/public/:pieceCid', () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )

      const result = await downloadAndValidate({
        url: `http://pdp.local/public/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      assert.deepEqual(result, testData)
    })

    it('should throw on download failure (404)', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = await Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/public/:pieceCid', () => {
          return HttpResponse.text('Not Found', {
            status: 404,
          })
        })
      )

      try {
        await downloadAndValidate({
          url: `http://pdp.local/public/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'Failed to download piece')
        assert.equal(error.reason, 'http')
        assert.equal(error.status, 404)
        assert.isTrue(error.notFound)
        assert.isFalse(error.verificationFailed)
        assert.equal(error.details, 'Not Found')
        assert.isTrue(HttpError.is(error.cause))
      }
    })

    it('should throw on server error (500)', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = await Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/public/:pieceCid', () => {
          return HttpResponse.text('Internal Server Error', {
            status: 500,
          })
        })
      )

      try {
        await downloadAndValidate({
          url: `http://pdp.local/public/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'Failed to download piece')
        assert.equal(error.reason, 'http')
        assert.equal(error.status, 500)
        assert.isFalse(error.notFound)
        assert.isFalse(error.verificationFailed)
        assert.isTrue(HttpError.is(error.cause))
      }
    })

    it('should fall back to the status when an HTTP error has no body', async () => {
      const pieceCid = await Piece.calculate(new Uint8Array([1, 2, 3, 4]))
      server.use(http.get('http://pdp.local/public/:pieceCid', () => new HttpResponse(null, { status: 503 })))

      await rejects(
        downloadAndValidate({
          url: `http://pdp.local/public/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
          retryCount: 0,
        }),
        (error) =>
          error instanceof DownloadPieceError &&
          error.reason === 'http' &&
          error.status === 503 &&
          error.details === 'HTTP 503'
      )
    })

    it('should throw on PieceCID verification failure', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = await Piece.calculate(testData)
      const wrongData = new Uint8Array([9, 9, 9, 9]) // Different data

      server.use(
        http.get('http://pdp.local/public/:pieceCid', () => {
          return HttpResponse.arrayBuffer(wrongData.buffer)
        })
      )

      try {
        await downloadAndValidate({
          url: `http://pdp.local/public/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'PieceCID verification failed')
        assert.equal(error.reason, 'mismatch')
        assert.isUndefined(error.status)
        assert.isFalse(error.notFound)
        assert.isTrue(error.verificationFailed)
      }
    })

    it('should handle null response body', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = await Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/public/:pieceCid', () => {
          return new HttpResponse()
        })
      )

      try {
        await downloadAndValidate({
          url: `http://pdp.local/public/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        // Accept either error message as HttpResponse() behaves differently in Node vs browser
        assert.match(error.message, /Response body is (null|empty)/)
        assert.equal(error.reason, 'empty')
        assert.isTrue(error.verificationFailed)
      }
    })

    it('should correctly stream and verify chunked data', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = await Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/public/:pieceCid', () => {
          // Split test data into chunks
          const chunk1 = testData.slice(0, 4)
          const chunk2 = testData.slice(4)

          // Create readable stream that emits chunks
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(chunk1)
              // Small delay to simulate network
              await new Promise((resolve) => setTimeout(resolve, 10))
              controller.enqueue(chunk2)
              controller.close()
            },
          })
          return new HttpResponse(stream, {
            status: 200,
          })
        })
      )

      const result = await downloadAndValidate({
        url: `http://pdp.local/public/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      // Verify we got all the data correctly reassembled
      assert.deepEqual(result, testData)
    })

    it('should handle large chunked downloads', async () => {
      // Create larger test data (1KB)
      const testData = new Uint8Array(1024)
      for (let i = 0; i < testData.length; i++) {
        testData[i] = i % 256
      }
      const pieceCid = await Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/public/:pieceCid', () => {
          // Create readable stream that emits in 128-byte chunks
          const chunkSize = 128
          let offset = 0

          const stream = new ReadableStream({
            async pull(controller) {
              if (offset >= testData.length) {
                controller.close()
                return
              }
              const chunk = testData.slice(offset, Math.min(offset + chunkSize, testData.length))
              offset += chunkSize
              controller.enqueue(chunk)
            },
          })
          return new HttpResponse(stream, { status: 200 })
        })
      )

      const result = await downloadAndValidate({
        url: `http://pdp.local/public/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      assert.deepEqual(result, testData)
    })
  })

  describe('downloadStream', () => {
    async function readAll(
      stream: ReadableStream<Uint8Array>,
      onChunk?: (chunk: Uint8Array) => void
    ): Promise<{ chunks: number; bytes: Uint8Array }> {
      let chunks = 0
      const counted = stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            chunks++
            onChunk?.(chunk)
            controller.enqueue(chunk)
          },
        })
      )
      const bytes = await readAllBytes(counted)
      return { chunks, bytes }
    }

    function chunkedResponse(data: Uint8Array, chunkSize: number) {
      let offset = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= data.length) {
            controller.close()
            return
          }
          controller.enqueue(data.slice(offset, offset + chunkSize))
          offset += chunkSize
        },
      })
      return new HttpResponse(stream, { status: 200 })
    }

    const testData = new Uint8Array(1024).map((_, i) => i % 256)

    it('should stream chunks and close when the PieceCID matches', async () => {
      const pieceCid = await Piece.calculate(testData)
      server.use(http.get('http://pdp.local/public/:pieceCid', () => chunkedResponse(testData, 128)))

      const stream = await downloadStream({
        url: `http://pdp.local/public/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      const { chunks, bytes } = await readAll(stream)
      assert.isAbove(chunks, 1)
      assert.deepEqual(bytes, testData)
    })

    it('should deliver all chunks then error when the PieceCID does not match', async () => {
      const pieceCid = await Piece.calculate(testData)
      const wrongData = testData.map((b) => b ^ 0xff)
      server.use(http.get('http://pdp.local/public/:pieceCid', () => chunkedResponse(wrongData, 128)))

      const stream = await downloadStream({
        url: `http://pdp.local/public/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      let received = 0
      await rejects(
        readAll(stream, (chunk) => {
          received += chunk.length
        }),
        (error) =>
          error instanceof DownloadPieceError &&
          error.reason === 'mismatch' &&
          error.details?.includes('PieceCID verification failed') === true
      )
      assert.equal(received, wrongData.length)
    })

    it('should error when a 200 response has an empty body', async () => {
      const pieceCid = await Piece.calculate(testData)
      server.use(
        http.get(
          'http://pdp.local/public/:pieceCid',
          () =>
            new HttpResponse(
              new ReadableStream({
                start(controller) {
                  controller.close()
                },
              }),
              { status: 200 }
            )
        )
      )

      const stream = await downloadStream({
        url: `http://pdp.local/public/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      await rejects(
        readAll(stream),
        (error) =>
          error instanceof DownloadPieceError && error.reason === 'empty' && error.details === 'Response body is empty'
      )
    })

    it('should error and stop reading as soon as the body exceeds the PieceCID size', async () => {
      const pieceCid = await Piece.calculate(testData)
      const chunk = new Uint8Array(64 * 1024)
      let pulled = 0
      server.use(
        http.get(
          'http://pdp.local/public/:pieceCid',
          () =>
            new HttpResponse(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  pulled++
                  controller.enqueue(chunk)
                },
              }),
              { status: 200 }
            )
        )
      )

      const stream = await downloadStream({
        url: `http://pdp.local/public/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      let received = 0
      await rejects(
        readAll(stream, (c) => {
          received += c.length
        }),
        (error) =>
          error instanceof DownloadPieceError &&
          error.reason === 'size' &&
          error.details?.includes('larger than the 1024 bytes') === true
      )
      assert.equal(received, 0)
      assert.isBelow(pulled, 10)
    })

    it('should pass through a body that ends exactly at the PieceCID size', async () => {
      const pieceCid = await Piece.calculate(testData)
      server.use(http.get('http://pdp.local/public/:pieceCid', () => chunkedResponse(testData, 1000)))

      const stream = await downloadStream({
        url: `http://pdp.local/public/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      const { bytes } = await readAll(stream)
      assert.deepEqual(bytes, testData)
    })

    it('should not validate or require a PieceCID when validate is false', async () => {
      const wrongData = new Uint8Array([9, 9, 9, 9])
      server.use(http.get('http://pdp.local/public/:pieceCid', () => HttpResponse.arrayBuffer(wrongData.buffer)))

      const stream = await downloadStream({ url: 'http://pdp.local/public/anything', validate: false })
      const { bytes } = await readAll(stream)
      assert.deepEqual(bytes, wrongData)
    })

    it('should reject before streaming on HTTP errors', async () => {
      const pieceCid = await Piece.calculate(testData)
      server.use(http.get('http://pdp.local/public/:pieceCid', () => HttpResponse.text('Not Found', { status: 404 })))

      await rejects(
        downloadStream({ url: `http://pdp.local/public/${pieceCid.toString()}`, expectedPieceCid: pieceCid }),
        (error) => error instanceof DownloadPieceError && error.reason === 'http' && error.notFound
      )
    })

    it('should reject on an invalid expected PieceCID', async () => {
      await rejects(downloadStream({ url: 'http://pdp.local/public/x', expectedPieceCid: 'not-a-cid' }), {
        name: 'InvalidPieceCIDError',
      })
    })
  })
})
