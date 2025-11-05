/* globals describe it beforeEach before after */

/**
 * Tests for PDPVerifier class
 */

import { calculate } from '@filoz/synapse-core/piece'
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { PDPVerifier } from '../pdp/index.ts'
import { ADDRESSES, JSONRPC, presets } from './mocks/jsonrpc/index.ts'

const server = setup([])

describe('PDPVerifier', () => {
  let provider: ethers.Provider
  let pdpVerifier: PDPVerifier
  const testAddress = ADDRESSES.calibration.pdpVerifier

  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
    server.use(JSONRPC(presets.basic))
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    pdpVerifier = new PDPVerifier(provider, testAddress)
  })

  describe('Instantiation', () => {
    it('should create instance and connect provider', () => {
      assert.exists(pdpVerifier)
      assert.isFunction(pdpVerifier.dataSetLive)
      assert.isFunction(pdpVerifier.getNextPieceId)
    })

    it('should create instance with custom address', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const customVerifier = new PDPVerifier(provider, customAddress)
      assert.exists(customVerifier)
      assert.isFunction(customVerifier.dataSetLive)
      assert.isFunction(customVerifier.getNextPieceId)
    })
  })

  describe('dataSetLive', () => {
    it('should check if data set is live', async () => {
      const isLive = await pdpVerifier.dataSetLive(123)
      assert.isTrue(isLive)
    })
  })

  describe('getNextPieceId', () => {
    it('should get next piece ID', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getNextPieceId: () => [5n],
          },
        })
      )

      const nextPieceId = await pdpVerifier.getNextPieceId(123)
      assert.equal(nextPieceId, 5)
    })
  })

  describe('getDataSetListener', () => {
    it('should get data set listener', async () => {
      const listener = await pdpVerifier.getDataSetListener(123)
      assert.equal(listener.toLowerCase(), ADDRESSES.calibration.warmStorage.toLowerCase())
    })
  })

  describe('getDataSetStorageProvider', () => {
    it('should get data set storage provider', async () => {
      const storageProvider = '0x1234567890123456789012345678901234567890'
      const proposedStorageProvider = '0xabcdef1234567890123456789012345678901234'

      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getDataSetStorageProvider: () => [storageProvider, proposedStorageProvider],
          },
        })
      )

      const result = await pdpVerifier.getDataSetStorageProvider(123)
      assert.equal(result.storageProvider.toLowerCase(), storageProvider.toLowerCase())
      assert.equal(result.proposedStorageProvider.toLowerCase(), proposedStorageProvider.toLowerCase())
    })
  })

  describe('getDataSetLeafCount', () => {
    it('should get data set leaf count', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getDataSetLeafCount: () => [10n],
          },
        })
      )

      const leafCount = await pdpVerifier.getDataSetLeafCount(123)
      assert.equal(leafCount, 10)
    })
  })

  describe('extractDataSetIdFromReceipt', () => {
    it('should extract data set ID from receipt', () => {
      const mockReceipt = {
        logs: [
          {
            topics: [
              '0x1234567890123456789012345678901234567890123456789012345678901234', // Event signature
              ethers.zeroPadValue('0x7b', 32), // Data set ID = 123
            ],
            data: `0x${'0'.repeat(64)}`,
          },
        ],
      } as any

      // Mock the interface to parse logs
      ;(pdpVerifier as any)._contract.interface.parseLog = (log: any) => {
        if (log.topics[0] === '0x1234567890123456789012345678901234567890123456789012345678901234') {
          return {
            name: 'DataSetCreated',
            args: {
              setId: BigInt(123),
            },
            fragment: {} as any,
            signature: 'DataSetCreated(uint256)',
            topic: log.topics[0],
          } as any
        }
        return null
      }

      const dataSetId = pdpVerifier.extractDataSetIdFromReceipt(mockReceipt)
      assert.equal(dataSetId, 123)
    })

    it('should return null if no DataSetCreated event found', () => {
      const mockReceipt = {
        logs: [],
      } as any

      const dataSetId = pdpVerifier.extractDataSetIdFromReceipt(mockReceipt)
      assert.isNull(dataSetId)
    })
  })

  describe('getActivePieces', () => {
    it('should handle AbortSignal', async () => {
      const controller = new AbortController()
      controller.abort()

      try {
        await pdpVerifier.getActivePieces(123, { signal: controller.signal })
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.equal(error.message, 'Operation aborted')
      }
    })

    it('should be callable with default options', async () => {
      assert.isFunction(pdpVerifier.getActivePieces)

      // Create a valid PieceCID for testing
      const testData = new Uint8Array(100).fill(42)
      const pieceCid = calculate(testData)
      const pieceCidHex = ethers.hexlify(pieceCid.bytes)

      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [[{ data: pieceCidHex as `0x${string}` }], [1n], false],
          },
        })
      )

      const result = await pdpVerifier.getActivePieces(123)
      assert.equal(result.pieces.length, 1)
      assert.equal(result.pieces[0].pieceId, 1)
      assert.equal(result.hasMore, false)
      assert.equal(result.pieces[0].pieceCid.toString(), pieceCid.toString())
    })
  })

  describe('getContractAddress', () => {
    it('should return the contract address', () => {
      const address = pdpVerifier.getContractAddress()
      assert.equal(address, testAddress)
    })
  })
})
