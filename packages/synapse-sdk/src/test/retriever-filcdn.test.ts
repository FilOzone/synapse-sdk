/* globals describe it */

import { asPieceCID } from '@filoz/synapse-core/piece'
import { assert } from 'chai'
import { FilBeamRetriever } from '../retriever/filbeam.ts'
import type { PieceCID, PieceRetriever } from '../types.ts'

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
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, 'calibration')
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
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, 'mainnet')
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
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, 'calibration')
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
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, 'calibration')
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
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, 'calibration')
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
        const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, 'calibration')
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

  describe('network handling', () => {
    it('should accept mainnet network', () => {
      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => new Response(),
      }

      const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, 'mainnet')
      assert.exists(cdnRetriever)
      assert.strictEqual(cdnRetriever.hostname(), 'filbeam.io')
    })

    it('should accept calibration network', () => {
      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => new Response(),
      }

      const cdnRetriever = new FilBeamRetriever(mockBaseRetriever, 'calibration')
      assert.exists(cdnRetriever)
      assert.strictEqual(cdnRetriever.hostname(), 'calibration.filbeam.io')
    })
  })
})
