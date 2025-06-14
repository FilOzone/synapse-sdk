/* globals describe it */
import { assert } from 'chai'
import { FilCdnRetriever } from '../retriever/filcdn.js'
import type { PieceRetriever, CommP } from '../types.js'
import { asCommP } from '../commp/index.js'

// Create a mock CommP for testing
const mockCommP = asCommP('baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq') as CommP

describe('FilCdnRetriever', () => {
  describe('pass-through behavior', () => {
    it('should pass through to base retriever', async () => {
      let baseCalled = false
      const baseResponse = new Response('test data', { status: 200 })

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async (commp: CommP, client: string, options?: any) => {
          baseCalled = true
          assert.equal(commp, mockCommP)
          assert.equal(client, '0xClient')
          assert.equal(options?.withCDN, true)
          assert.equal(options?.providerAddress, '0xProvider')
          return baseResponse
        }
      }

      const cdnRetriever = new FilCdnRetriever(mockBaseRetriever, 'calibration')
      const response = await cdnRetriever.fetchPiece(
        mockCommP,
        '0xClient',
        {
          withCDN: true,
          providerAddress: '0xProvider'
        }
      )

      assert.isTrue(baseCalled, 'Base retriever should be called')
      assert.equal(response, baseResponse)
    })

    it('should propagate abort signal to base retriever', async () => {
      const controller = new AbortController()
      let signalPropagated = false

      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async (commp: CommP, client: string, options?: any) => {
          if (options?.signal != null) {
            signalPropagated = true
            assert.equal(options.signal, controller.signal)
          }
          return new Response('test data')
        }
      }

      const cdnRetriever = new FilCdnRetriever(mockBaseRetriever, 'mainnet')
      await cdnRetriever.fetchPiece(
        mockCommP,
        '0xClient',
        { signal: controller.signal }
      )

      assert.isTrue(signalPropagated, 'Signal should be propagated')
    })
  })

  describe('network handling', () => {
    it('should accept mainnet network', () => {
      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => new Response()
      }

      const cdnRetriever = new FilCdnRetriever(mockBaseRetriever, 'mainnet')
      assert.exists(cdnRetriever)
    })

    it('should accept calibration network', () => {
      const mockBaseRetriever: PieceRetriever = {
        fetchPiece: async () => new Response()
      }

      const cdnRetriever = new FilCdnRetriever(mockBaseRetriever, 'calibration')
      assert.exists(cdnRetriever)
    })
  })
})
