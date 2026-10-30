/**
 * Streaming upload against a real HTTP server (Node only): MSW intercepts
 * fetch before the request body would be buffered or a redirect handled.
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { assert } from 'chai'
import * as Piece from '../src/piece/index.ts'
import { uploadPieceStreaming } from '../src/sp/upload-streaming.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'

const MiB = 2 ** 20
const pieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

async function withServer(putStatus: number, fn: (serviceURL: string) => Promise<void>) {
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/pdp/piece/uploads') {
        res.writeHead(201, { Location: '/pdp/piece/uploads/0123abcd' }).end()
      } else if (req.method === 'PUT') {
        res.writeHead(putStatus, { Location: '/elsewhere' }).end()
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
  } finally {
    server.close()
  }
}

describe('uploadPieceStreaming over HTTP', () => {
  it('does not buffer the streamed body', async function () {
    this.timeout(60_000)
    const total = 1024 * MiB
    let sent = 0
    const baseline = process.memoryUsage().arrayBuffers
    let peak = 0
    const data = new ReadableStream<Uint8Array>({
      pull(controller) {
        peak = Math.max(peak, process.memoryUsage().arrayBuffers - baseline)
        if (sent >= total) return controller.close()
        controller.enqueue(new Uint8Array(MiB))
        sent += MiB
      },
    })

    await withServer(204, async (serviceURL) => {
      const result = await uploadPieceStreaming({ serviceURL, data, pieceCid })
      assert.strictEqual(result.size, total)
    })
    assert.isBelow(peak, 256 * MiB, `arrayBuffers grew by ${Math.round(peak / MiB)} MiB`)
  })

  for (const status of [307, 308]) {
    it(`rejects a ${status} redirect with a clear error`, async () => {
      await withServer(status, async (serviceURL) => {
        const data = new Blob([new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE)]).stream()
        try {
          await uploadPieceStreaming({ serviceURL, data, pieceCid })
          assert.fail('expected upload to fail')
        } catch (error) {
          assert.instanceOf(error, Error)
          assert.include(error.message, 'The storage provider redirected the upload')
          assert.include(error.message, `${serviceURL}pdp/piece/uploads/0123abcd`)
          assert.instanceOf(error.cause, Error)
        }
      })
    })
  }
})
