/**
 * Streaming upload memory (Node only): needs a real HTTP server, since MSW
 * intercepts fetch before the request body would be buffered.
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { assert } from 'chai'
import * as Piece from '../src/piece/index.ts'
import { uploadPieceStreaming } from '../src/sp/upload-streaming.ts'

const MiB = 2 ** 20

describe('uploadPieceStreaming memory', () => {
  it('does not buffer the streamed body', async function () {
    this.timeout(60_000)
    const server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/pdp/piece/uploads') {
          res.writeHead(201, { Location: '/pdp/piece/uploads/0123abcd' }).end()
        } else if (req.method === 'PUT') {
          res.writeHead(204).end()
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

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

    try {
      const result = await uploadPieceStreaming({
        serviceURL: `http://127.0.0.1:${port}/`,
        data,
        pieceCid: Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'),
      })
      assert.strictEqual(result.size, total)
    } finally {
      server.close()
    }
    assert.isBelow(peak, 256 * MiB, `arrayBuffers grew by ${Math.round(peak / MiB)} MiB`)
  })
})
