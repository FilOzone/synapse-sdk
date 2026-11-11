import assert from 'assert'
import { AbortError } from 'iso-web/http'
import { setup } from 'iso-web/msw'
import { createPublicClient, custom, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { calibrationTransport, getTransport } from '../src/client.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { abortable, throwIfAborted, withSignal } from '../src/utils/index.ts'
import { getPdpDataSet } from '../src/warm-storage/get-pdp-data-set.ts'

describe('abort helpers', () => {
  /** Listen for unhandled rejections in Node and browsers, swallowing them; returns the unsubscribe. */
  function onUnhandledRejection(listener: (reason: unknown) => void): () => void {
    if (typeof window === 'undefined') {
      const handler = (reason: unknown) => listener(reason)
      process.on('unhandledRejection', handler)
      return () => process.off('unhandledRejection', handler)
    }
    const handler = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      listener(event.reason)
    }
    window.addEventListener('unhandledrejection', handler)
    return () => window.removeEventListener('unhandledrejection', handler)
  }

  function neverSettles() {
    // the promise stays pending
  }

  describe('throwIfAborted', () => {
    it('does nothing without a signal or before abort', () => {
      throwIfAborted(undefined)
      throwIfAborted(new AbortController().signal)
    })

    it('throws AbortError once aborted', () => {
      assert.throws(
        () => throwIfAborted(AbortSignal.abort()),
        (err: unknown) => err instanceof AbortError
      )
    })
  })

  describe('abortable', () => {
    it('settles like the promise when not aborted', async () => {
      assert.strictEqual(await abortable(Promise.resolve(1), new AbortController().signal), 1)
    })

    it('rejects with AbortError when the signal aborts first', async () => {
      const controller = new AbortController()
      const pending = abortable(new Promise<never>(neverSettles), controller.signal)
      controller.abort()
      await assert.rejects(pending, (err: unknown) => err instanceof AbortError)
    })

    it('handles a later rejection of the promise when the signal already aborted', async () => {
      let rejectLater: (reason: Error) => void = neverSettles
      const promise = new Promise<never>((_, reject) => {
        rejectLater = reject
      })
      const unhandled: unknown[] = []
      const stop = onUnhandledRejection((reason) => unhandled.push(reason))
      try {
        await assert.rejects(abortable(promise, AbortSignal.abort()), (err: unknown) => err instanceof AbortError)
        rejectLater(new Error('late failure'))
        await new Promise((resolve) => setTimeout(resolve, 10))
        assert.deepStrictEqual(unhandled, [])
      } finally {
        stop()
      }
    })
  })

  describe('withSignal', () => {
    function hangingTransport() {
      let calls = 0
      const transport = custom({
        request: async ({ method }) => {
          calls++
          if (method === 'eth_chainId') {
            return '0x1'
          }
          return new Promise<never>(neverSettles)
        },
      })
      return { transport, calls: () => calls }
    }

    it('returns the transport unchanged without a signal', () => {
      const { transport } = hangingTransport()
      assert.strictEqual(withSignal(transport, undefined), transport)
    })

    it('passes requests through before abort', async () => {
      const { transport } = hangingTransport()
      const client = createPublicClient({ transport: withSignal(transport, new AbortController().signal) })
      assert.strictEqual(await client.getChainId(), 1)
    })

    it('rejects requests in flight once the signal aborts', async () => {
      const controller = new AbortController()
      const { transport } = hangingTransport()
      const client = createPublicClient({ transport: withSignal(transport, controller.signal) })
      const pending = client.getBlockNumber({ cacheTime: 0 })
      controller.abort()
      await assert.rejects(pending, (err: unknown) => err instanceof AbortError)
    })

    it('rejects without sending once the signal aborted', async () => {
      const { transport, calls } = hangingTransport()
      const client = createPublicClient({ transport: withSignal(transport, AbortSignal.abort()) })
      await assert.rejects(client.getChainId(), (err: unknown) => err instanceof AbortError)
      assert.strictEqual(calls(), 0)
    })

    it('returns a rejected promise instead of throwing once the signal aborted', async () => {
      const { transport, calls } = hangingTransport()
      const { request } = withSignal(transport, AbortSignal.abort())({})
      let pending: Promise<unknown> | undefined
      assert.doesNotThrow(() => {
        pending = request({ method: 'eth_chainId' })
      })
      await assert.rejects(pending as Promise<unknown>, (err: unknown) => err instanceof AbortError)
      assert.strictEqual(calls(), 0)
    })
  })

  describe('getTransport with signal', () => {
    it('returns the default transport without a signal', () => {
      assert.strictEqual(getTransport(calibration, {}), calibrationTransport)
    })

    it('wraps the default transport with a signal', async () => {
      const transport = getTransport(calibration, { signal: AbortSignal.abort() })
      assert.notStrictEqual(transport, calibrationTransport)
      const client = createPublicClient({ chain: calibration, transport })
      await assert.rejects(client.getChainId(), (err: unknown) => err instanceof AbortError)
    })
  })

  describe('contract reads on a withSignal client', () => {
    const server = setup()

    before(async () => {
      await server.start()
    })

    after(() => {
      server.stop()
    })

    beforeEach(() => {
      server.use(JSONRPC(presets.basic))
    })

    function abortedClient() {
      return createPublicClient({ chain: calibration, transport: withSignal(http(), AbortSignal.abort()) })
    }

    it('rejects with the AbortError in the cause chain', async () => {
      await assert.rejects(getPdpDataSet(abortedClient(), { dataSetId: 1n }), (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.ok(!(err instanceof AbortError))
        let cause: unknown = err
        while (cause instanceof Error && !(cause instanceof AbortError)) {
          cause = cause.cause
        }
        return cause instanceof AbortError
      })
    })

    it('rejects with AbortError itself when wrapped in abortable', async () => {
      const signal = AbortSignal.abort()
      const client = createPublicClient({ chain: calibration, transport: withSignal(http(), signal) })
      await assert.rejects(
        abortable(getPdpDataSet(client, { dataSetId: 1n }), signal),
        (err: unknown) => err instanceof AbortError
      )
    })
  })
})
