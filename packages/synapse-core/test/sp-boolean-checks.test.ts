import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { delay, HttpResponse, http } from 'msw'
import { FindPieceError } from '../src/errors/pdp.ts'
import { findPieceHandler } from '../src/mocks/pdp.ts'
import * as Piece from '../src/piece/index.ts'
import { AbortError, hasPiece, isReachable } from '../src/sp/index.ts'

const pieceCidStr = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
const pieceCid = Piece.from(pieceCidStr)
const serviceURL = 'https://pdp.example.com'

describe('SP boolean checks', () => {
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

  describe('hasPiece', () => {
    it('returns true when the provider has the piece', async () => {
      server.use(findPieceHandler(pieceCidStr, true))
      assert.isTrue(await hasPiece({ serviceURL, pieceCid }))
    })

    it('returns false on 404 without retrying', async () => {
      let attempts = 0
      server.use(
        http.get(`${serviceURL}/pdp/piece`, () => {
          attempts++
          return HttpResponse.text(null, { status: 404 })
        })
      )
      assert.isFalse(await hasPiece({ serviceURL, pieceCid }))
      assert.equal(attempts, 1)
    })

    it('returns false while the piece is processing', async () => {
      server.use(http.get(`${serviceURL}/pdp/piece`, () => HttpResponse.json({}, { status: 202 })))
      assert.isFalse(await hasPiece({ serviceURL, pieceCid }))
    })

    it('throws on errors that do not mean not found', async () => {
      server.use(http.get(`${serviceURL}/pdp/piece`, () => HttpResponse.text('boom', { status: 500 })))
      try {
        await hasPiece({ serviceURL, pieceCid, timeout: 5000 })
        assert.fail('Expected hasPiece to throw')
      } catch (error) {
        assert.instanceOf(error, FindPieceError)
        assert.isFalse(error.notFound)
      }
    })

    it('throws AbortError on abort', async () => {
      server.use(
        http.get(`${serviceURL}/pdp/piece`, async () => {
          await delay('infinite')
          return HttpResponse.json({ pieceCid: pieceCidStr })
        })
      )
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 20)
      try {
        await hasPiece({ serviceURL, pieceCid, signal: controller.signal })
        assert.fail('Expected hasPiece to be aborted')
      } catch (error) {
        assert.instanceOf(error, AbortError)
      }
    })
    it('throws when the provider returns a different piece', async () => {
      const other = 'bafkzcibcaapao7s3mtzihucsgkfghqoatbqj3ftmkf3xg2hyl3s7ttw4xjeusfi'
      server.use(http.get(`${serviceURL}/pdp/piece`, () => HttpResponse.json({ pieceCid: other })))
      try {
        await hasPiece({ serviceURL, pieceCid })
        assert.fail('Expected hasPiece to throw')
      } catch (error) {
        assert.instanceOf(error, FindPieceError)
        assert.isFalse(error.notFound)
        assert.include(error.message, 'different piece')
      }
    })

    it('throws FindPieceError when the returned pieceCid is invalid', async () => {
      server.use(http.get(`${serviceURL}/pdp/piece`, () => HttpResponse.json({ pieceCid: 'not-a-cid' })))
      try {
        await hasPiece({ serviceURL, pieceCid })
        assert.fail('Expected hasPiece to throw')
      } catch (error) {
        assert.instanceOf(error, FindPieceError)
        assert.isFalse(error.notFound)
      }
    })

    it('throws AbortError when aborted while the body is read', async () => {
      const controller = new AbortController()
      server.use(
        http.get(`${serviceURL}/pdp/piece`, () => {
          const body = new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{"pieceCid":'))
              setTimeout(() => controller.abort(), 20)
            },
          })
          return new HttpResponse(body, { status: 200, headers: { 'content-type': 'application/json' } })
        })
      )
      try {
        await hasPiece({ serviceURL, pieceCid, signal: controller.signal })
        assert.fail('Expected hasPiece to be aborted')
      } catch (error) {
        assert.instanceOf(error, AbortError)
      }
    })
  })

  describe('isReachable', () => {
    it('returns true when the ping succeeds', async () => {
      server.use(http.get(`${serviceURL}/pdp/ping`, () => new HttpResponse(null, { status: 200 })))
      assert.isTrue(await isReachable(serviceURL))
    })

    it('returns false on an HTTP error', async () => {
      server.use(http.get(`${serviceURL}/pdp/ping`, () => new HttpResponse(null, { status: 400 })))
      assert.isFalse(await isReachable(serviceURL))
    })

    it('returns false on a network error', async () => {
      server.use(http.get(`${serviceURL}/pdp/ping`, () => HttpResponse.error()))
      assert.isFalse(await isReachable(serviceURL, { timeout: 2000 }))
    })

    it('rethrows errors that are not about reachability', async () => {
      try {
        await isReachable('not a url')
        assert.fail('Expected isReachable to throw')
      } catch (error) {
        assert.notInstanceOf(error, AbortError)
      }
    })

    it('returns false on timeout', async () => {
      server.use(
        http.get(`${serviceURL}/pdp/ping`, async () => {
          await delay(200)
          return new HttpResponse(null, { status: 200 })
        })
      )
      assert.isFalse(await isReachable(serviceURL, { timeout: 10 }))
    })

    it('throws AbortError on abort', async () => {
      server.use(
        http.get(`${serviceURL}/pdp/ping`, async () => {
          await delay('infinite')
          return new HttpResponse(null, { status: 200 })
        })
      )
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 20)
      try {
        await isReachable(serviceURL, { signal: controller.signal })
        assert.fail('Expected isReachable to be aborted')
      } catch (error) {
        assert.instanceOf(error, AbortError)
      }
    })
  })
})
