/**
 * Streaming upload against a real HTTP server (Node only): MSW intercepts
 * fetch before the request body would be buffered or a redirect handled.
 */

import { createReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    const total = 512 * MiB
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
    // GC lag alone reaches ~160 MiB; a buffered body peaks above 512 MiB
    assert.isBelow(peak, 256 * MiB, `arrayBuffers grew by ${Math.round(peak / MiB)} MiB`)
  })

  it('uploads a Node.js Readable without conversion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synapse-upload-'))
    try {
      const path = join(dir, 'piece.bin')
      const bytes = new Uint8Array(4 * MiB).fill(0x42)
      await writeFile(path, bytes)
      const stream = createReadStream(path, { highWaterMark: 64 * 1024 })
      await withServer(204, async (serviceURL) => {
        const result = await uploadPieceStreaming({ serviceURL, data: stream })
        assert.strictEqual(result.size, bytes.length)
        assert.strictEqual(result.pieceCid.toString(), (await Piece.calculate(bytes)).toString())
      })
      assert.isTrue(stream.closed)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects with ENOENT for a missing file, without creating an upload session', async () => {
    let requests = 0
    const server = createServer((req, res) => {
      requests++
      req.resume()
      res.writeHead(201, { Location: '/pdp/piece/uploads/0123abcd' }).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const serviceURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    const stream = createReadStream(join(tmpdir(), `synapse-missing-${crypto.randomUUID()}`))
    let error: unknown
    try {
      await uploadPieceStreaming({ serviceURL, data: stream, pieceCid })
    } catch (e) {
      error = e
    } finally {
      server.close()
    }
    assert.instanceOf(error, Error)
    assert.strictEqual((error as NodeJS.ErrnoException).code, 'ENOENT')
    assert.strictEqual(requests, 0)
    assert.isTrue(stream.destroyed)
  })

  it('closes a file stream when session creation fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synapse-upload-'))
    const server = createServer((req, res) => {
      req.resume()
      res.writeHead(500).end('boom')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const serviceURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    try {
      const path = join(dir, 'piece.bin')
      await writeFile(path, new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE))
      const stream = createReadStream(path)
      try {
        await uploadPieceStreaming({ serviceURL, data: stream, pieceCid, retryCount: 0 })
        assert.fail('expected upload to fail')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.include(error.message, 'Failed to create upload session')
      }
      await new Promise((resolve) => setImmediate(resolve))
      assert.isTrue(stream.destroyed)
    } finally {
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
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
