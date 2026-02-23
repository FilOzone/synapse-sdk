import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { DownloadPieceError } from '../src/errors/pdp.ts'
import { downloadAndValidate } from '../src/piece/download.ts'
import * as Piece from '../src/piece/piece.ts'
import {} from '../src/sp/sp.ts'

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
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )

      const result = await downloadAndValidate({
        url: `http://pdp.local/piece/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      assert.deepEqual(result, testData)
    })

    it('should throw on download failure (404)', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return HttpResponse.text('Not Found', {
            status: 404,
          })
        })
      )

      try {
        await downloadAndValidate({
          url: `http://pdp.local/piece/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'Failed to download piece')
      }
    })

    it('should throw on server error (500)', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return HttpResponse.text('Internal Server Error', {
            status: 500,
          })
        })
      )

      try {
        await downloadAndValidate({
          url: `http://pdp.local/piece/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'Failed to download piece')
      }
    })

    it('should throw on PieceCID verification failure', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)
      const wrongData = new Uint8Array([9, 9, 9, 9]) // Different data

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return HttpResponse.arrayBuffer(wrongData.buffer)
        })
      )

      try {
        await downloadAndValidate({
          url: `http://pdp.local/piece/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'PieceCID verification failed')
      }
    })

    it('should handle null response body', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return new HttpResponse()
        })
      )

      try {
        await downloadAndValidate({
          url: `http://pdp.local/piece/${pieceCid.toString()}`,
          expectedPieceCid: pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        // Accept either error message as HttpResponse() behaves differently in Node vs browser
        assert.match(error.message, /Response body is (null|empty)/)
      }
    })

    it('should correctly stream and verify chunked data', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
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
        url: `http://pdp.local/piece/${pieceCid.toString()}`,
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
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
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
        url: `http://pdp.local/piece/${pieceCid.toString()}`,
        expectedPieceCid: pieceCid,
      })
      assert.deepEqual(result, testData)
    })
  })
})
