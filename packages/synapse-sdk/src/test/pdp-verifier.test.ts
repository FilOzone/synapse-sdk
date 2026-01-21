/* globals describe it beforeEach before after */

/**
 * Tests for PDPVerifier class
 */

import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { calculate } from '@filoz/synapse-core/piece'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { bytesToHex, createPublicClient, http as viemHttp } from 'viem'
import { PDPVerifier } from '../pdp/index.ts'

const server = setup()

describe('PDPVerifier', () => {
  let pdpVerifier: PDPVerifier
  const testAddress = Mocks.ADDRESSES.calibration.pdpVerifier

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
    server.use(Mocks.JSONRPC(Mocks.presets.basic))
    const publicClient = createPublicClient({
      chain: calibration,
      transport: viemHttp(),
    })
    pdpVerifier = new PDPVerifier({ client: publicClient })
  })

  describe('Instantiation', () => {
    it('should create instance and connect provider', () => {
      assert.exists(pdpVerifier)
      assert.isFunction(pdpVerifier.dataSetLive)
      assert.isFunction(pdpVerifier.getNextPieceId)
    })

    it('should create instance with custom address', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const publicClient = createPublicClient({
        chain: calibration,
        transport: viemHttp(),
      })
      const customVerifier = new PDPVerifier({ client: publicClient, address: customAddress })
      assert.exists(customVerifier)
      assert.isFunction(customVerifier.dataSetLive)
      assert.isFunction(customVerifier.getNextPieceId)
    })
  })

  describe('dataSetLive', () => {
    it('should check if data set is live', async () => {
      const isLive = await pdpVerifier.dataSetLive(123n)
      assert.isTrue(isLive)
    })
  })

  describe('getNextPieceId', () => {
    it('should get next piece ID', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getNextPieceId: () => [5n],
          },
        })
      )

      const nextPieceId = await pdpVerifier.getNextPieceId(123n)
      assert.equal(nextPieceId, 5n)
    })
  })

  describe('getDataSetListener', () => {
    it('should get data set listener', async () => {
      const listener = await pdpVerifier.getDataSetListener(123n)
      assert.equal(listener.toLowerCase(), Mocks.ADDRESSES.calibration.warmStorage.toLowerCase())
    })
  })

  describe('getDataSetStorageProvider', () => {
    it('should get data set storage provider', async () => {
      const storageProvider = '0x1234567890123456789012345678901234567890'
      const proposedStorageProvider = '0xabcdef1234567890123456789012345678901234'

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getDataSetStorageProvider: () => [storageProvider, proposedStorageProvider],
          },
        })
      )

      const result = await pdpVerifier.getDataSetStorageProvider(123n)
      assert.equal(result.storageProvider.toLowerCase(), storageProvider.toLowerCase())
      assert.equal(result.proposedStorageProvider.toLowerCase(), proposedStorageProvider.toLowerCase())
    })
  })

  describe('getDataSetLeafCount', () => {
    it('should get data set leaf count', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getDataSetLeafCount: () => [10n],
          },
        })
      )

      const leafCount = await pdpVerifier.getDataSetLeafCount(123n)
      assert.equal(leafCount, 10n)
    })
  })

  describe('getActivePieces', () => {
    it('should handle AbortSignal', async () => {
      const controller = new AbortController()
      controller.abort()

      try {
        await pdpVerifier.getActivePieces(123n, { signal: controller.signal })
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
      const pieceCidHex = bytesToHex(pieceCid.bytes)

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: () => [[{ data: pieceCidHex as `0x${string}` }], [1n], false],
          },
        })
      )

      const result = await pdpVerifier.getActivePieces(123n)
      assert.equal(result.pieces.length, 1)
      assert.equal(result.pieces[0].pieceId, 1n)
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

  describe('getScheduledRemovals', () => {
    it('should get scheduled removals for a data set', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getScheduledRemovals: () => [[1n, 2n, 5n]],
          },
        })
      )

      const scheduledRemovals = await pdpVerifier.getScheduledRemovals(123n)
      assert.isArray(scheduledRemovals)
      assert.equal(scheduledRemovals.length, 3)
      assert.equal(scheduledRemovals[0], 1n)
      assert.equal(scheduledRemovals[1], 2n)
      assert.equal(scheduledRemovals[2], 5n)
    })

    it('should return empty array when no removals scheduled', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getScheduledRemovals: () => [[]],
          },
        })
      )

      const scheduledRemovals = await pdpVerifier.getScheduledRemovals(123n)
      assert.isArray(scheduledRemovals)
      assert.equal(scheduledRemovals.length, 0)
    })
  })
})
