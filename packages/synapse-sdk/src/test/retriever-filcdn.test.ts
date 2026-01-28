/* globals describe it */

import type { Chain } from '@filoz/synapse-core/chains'
import { asPieceCID } from '@filoz/synapse-core/piece'
import { assert } from 'chai'
import { FilBeamRetriever } from '../retriever/filbeam.ts'
import type { PieceCID, PieceRetriever } from '../types.ts'

const calibrationChain = { filbeam: { retrievalDomain: 'calibration.filbeam.io' } } as unknown as Chain
const mainnetChain = { filbeam: { retrievalDomain: 'filbeam.io' } } as unknown as Chain
const devnetChain = { id: 31415926, name: 'Filecoin - Devnet', filbeam: null } as unknown as Chain

// Create a mock PieceCID for testing
const mockPieceCID = asPieceCID('bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace') as PieceCID

describe('FilBeamRetriever', () => {
  describe('pass-through behavior', () => {
    it('should pass through when withCDN=false', async () => {
      let baseCalled = false
      const baseResponse = new Response('test data', { status: 200 })

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async (pieceCid: PieceCID, client: string, options?: any) => {
          baseCalled = true
          assert.equal(pieceCid, mockPieceCID)
          assert.equal(client, '0xClient')
          assert.equal(options?.withCDN, false)
          return baseResponse
        },
      }

      const originalFetch = global.fetch
      global.fetch = async () => {
        throw new Error('Should not call fetch when withCDN is false')
      }

      try {
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, calibrationChain)
        const response = await cdnRetriever.fetchPiece(mockPieceCID, '0xClient', {
          withCDN: false,
        })

        assert.isTrue(baseCalled, 'Base retriever should be called')
        assert.equal(response, baseResponse)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should propagate abort signal to base retriever', async () => {
      const controller = new AbortController()
      let signalPropagated = false

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async (_pieceCid: PieceCID, _client: string, options?: any) => {
          if (options?.signal != null) {
            signalPropagated = true
            assert.equal(options.signal, controller.signal)
          }
          return new Response('test data')
        },
      }
      const originalFetch = global.fetch
      global.fetch = async () => {
        throw new Error('Should not call fetch when withCDN is false')
      }

      try {
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, mainnetChain)
        await cdnRetriever.fetchPiece(mockPieceCID, '0xClient', {
          signal: controller.signal,
          withCDN: false,
        })

        assert.isTrue(signalPropagated, 'Signal should be propagated')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should pass through when CDN responds with 402', async () => {
      let baseCalled = false
      let cdnCalled = false
      const baseResponse = new Response('test data', { status: 200 })

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async (pieceCid: PieceCID, client: string, options?: any) => {
          baseCalled = true
          assert.equal(pieceCid, mockPieceCID)
          assert.equal(client, '0xClient')
          assert.equal(options?.withCDN, true)
          return baseResponse
        },
      }
      const originalFetch = global.fetch
      global.fetch = async () => {
        cdnCalled = true
        const response = new Response('Payment required', { status: 402 })
        return response
      }

      try {
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, calibrationChain)
        const response = await cdnRetriever.fetchPiece(mockPieceCID, '0xClient', {
          withCDN: true,
        })

        assert.isTrue(cdnCalled, 'CDN fetch should be attempted')
        assert.isTrue(baseCalled, 'Base retriever should be called')
        assert.equal(response, baseResponse)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should pass through when CDN responds badly', async () => {
      let baseCalled = false
      let cdnCalled = false
      const baseResponse = new Response('test data', { status: 200 })

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async (pieceCid: PieceCID, client: string, options?: any) => {
          baseCalled = true
          assert.equal(pieceCid, mockPieceCID)
          assert.equal(client, '0xClient')
          assert.equal(options?.withCDN, true)
          return baseResponse
        },
      }
      const originalFetch = global.fetch
      global.fetch = async () => {
        cdnCalled = true
        const response = new Response('Internal Server Error', { status: 500 })
        return response
      }

      try {
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, calibrationChain)
        const response = await cdnRetriever.fetchPiece(mockPieceCID, '0xClient', {
          withCDN: true,
        })

        assert.isTrue(cdnCalled, 'CDN fetch should be attempted')
        assert.isTrue(baseCalled, 'Base retriever should be called')
        assert.equal(response, baseResponse)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should pass through on network error', async () => {
      let baseCalled = false
      let cdnCalled = false
      const baseResponse = new Response('test data', { status: 200 })

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async (pieceCid: PieceCID, client: string, options?: any) => {
          baseCalled = true
          assert.equal(pieceCid, mockPieceCID)
          assert.equal(client, '0xClient')
          assert.equal(options?.withCDN, true)
          return baseResponse
        },
      }
      const originalFetch = global.fetch
      global.fetch = async () => {
        cdnCalled = true
        throw new Error('Network error')
      }

      try {
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, calibrationChain)
        const response = await cdnRetriever.fetchPiece(mockPieceCID, '0xClient', {
          withCDN: true,
        })

        assert.isTrue(cdnCalled, 'CDN fetch should be attempted')
        assert.isTrue(baseCalled, 'Base retriever should be called')
        assert.equal(response, baseResponse)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('CDN handling', () => {
    it('should respond and not pass through', async () => {
      let baseCalled = false
      let cdnCalled = false
      const cdnResponse = new Response('CDN data', { status: 200 })

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => {
          baseCalled = true
          throw new Error()
        },
      }
      const originalFetch = global.fetch
      global.fetch = async (url) => {
        cdnCalled = true
        assert.strictEqual(
          url,
          `https://0xClient.calibration.filbeam.io/${mockPieceCID.toString()}`,
          'CDN URL should be constructed correctly'
        )
        return cdnResponse
      }

      try {
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, calibrationChain)
        const response = await cdnRetriever.fetchPiece(mockPieceCID, '0xClient', {
          withCDN: true,
        })

        assert.isTrue(cdnCalled, 'CDN fetch should be called')
        assert.isFalse(baseCalled, 'Base retriever should not be called')
        assert.equal(response, cdnResponse)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('chain handling', () => {
    it('should use retrieval domain from mainnet chain', () => {
      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => new Response(),
      }

      const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, mainnetChain)
      assert.strictEqual(cdnRetriever.hostname(), 'filbeam.io')
    })

    it('should use retrieval domain from calibration chain', () => {
      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => new Response(),
      }

      const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, calibrationChain)
      assert.strictEqual(cdnRetriever.hostname(), 'calibration.filbeam.io')
    })

    it('should return null hostname when chain.filbeam is null', () => {
      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => new Response(),
      }

      const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, devnetChain)
      assert.isNull(cdnRetriever.hostname())
    })

    it('should fall back to direct retrieval when chain.filbeam is null and withCDN=true', async () => {
      let baseCalled = false
      const baseResponse = new Response('test data', { status: 200 })
      const warnings: string[] = []

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async (pieceCid: PieceCID, client: string) => {
          baseCalled = true
          assert.equal(pieceCid, mockPieceCID)
          assert.equal(client, '0xClient')
          return baseResponse
        },
      }

      const originalWarn = console.warn
      console.warn = (msg: string, ...args: unknown[]) => {
        warnings.push([msg, ...args].join(' '))
      }
      const originalFetch = global.fetch
      global.fetch = async () => {
        throw new Error('Should not call fetch when chain.filbeam is null')
      }

      try {
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, devnetChain)
        const response = await cdnRetriever.fetchPiece(mockPieceCID, '0xClient', {
          withCDN: true,
        })

        assert.isTrue(baseCalled, 'Base retriever should be called')
        assert.equal(response, baseResponse)
        assert.lengthOf(warnings, 1, 'Should log exactly one warning')
        assert.include(warnings[0], '31415926', 'Warning should include chain ID')
        assert.include(warnings[0], 'Filecoin - Devnet', 'Warning should include chain name')
      } finally {
        console.warn = originalWarn
        global.fetch = originalFetch
      }
    })

    it('should pass through without warning when chain.filbeam is null and withCDN=false', async () => {
      let baseCalled = false
      const baseResponse = new Response('test data', { status: 200 })
      const warnings: string[] = []

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => {
          baseCalled = true
          return baseResponse
        },
      }

      const originalWarn = console.warn
      console.warn = (msg: string, ...args: unknown[]) => {
        warnings.push([msg, ...args].join(' '))
      }

      try {
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, devnetChain)
        const response = await cdnRetriever.fetchPiece(mockPieceCID, '0xClient', {
          withCDN: false,
        })

        assert.isTrue(baseCalled, 'Base retriever should be called')
        assert.equal(response, baseResponse)
        assert.lengthOf(warnings, 0, 'Should not log any warnings when CDN not requested')
      } finally {
        console.warn = originalWarn
      }
    })
  })
})
