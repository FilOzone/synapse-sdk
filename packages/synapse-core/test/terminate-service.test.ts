import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, encodeAbiParameters, encodeEventTopics, http, type Log, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Abis from '../src/abis/index.ts'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  extractTerminateServiceEvent,
  terminateService,
  terminateServiceCall,
  terminateServiceSync,
} from '../src/warm-storage/terminate-service.ts'

describe('terminateService', () => {
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

  describe('terminateServiceCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = terminateServiceCall({
        chain: calibration,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'terminateService')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, calibration.contracts.fwss.address)
      assert.equal(call.abi, calibration.contracts.fwss.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = terminateServiceCall({
        chain: mainnet,
        dataSetId: 456n,
      })

      assert.equal(call.functionName, 'terminateService')
      assert.deepEqual(call.args, [456n])
      assert.equal(call.address, mainnet.contracts.fwss.address)
      assert.equal(call.abi, mainnet.contracts.fwss.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = terminateServiceCall({
        chain: calibration,
        dataSetId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
      assert.deepEqual(call.args, [1n])
    })

    it('should handle large dataSetId values', () => {
      const largeId = 2n ** 128n
      const call = terminateServiceCall({
        chain: calibration,
        dataSetId: largeId,
      })

      assert.deepEqual(call.args, [largeId])
    })
  })

  describe('terminateService (with mocked RPC)', () => {
    it('should terminate service and return transaction hash', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
            terminateService: (args) => {
              assert.deepEqual(args, [1n])
              return []
            },
          },
        })
      )

      const account = privateKeyToAccount(PRIVATE_KEYS.key1)
      const client = createWalletClient({
        account,
        chain: calibration,
        transport: http(),
      })

      const hash = await terminateService(client, {
        dataSetId: 1n,
      })

      assert.ok(hash.startsWith('0x'))
      assert.equal(hash.length, 66) // 0x + 64 hex chars
    })
  })

  describe('terminateServiceSync (with mocked RPC)', () => {
    it('should wait for confirmation and return receipt with ServiceTerminated event', async () => {
      let onHashCalled = false
      let receivedHash: string | undefined
      const dataSetId = 1n
      const pdpRailId = 10n
      const cacheMissRailId = 20n
      const cdnRailId = 30n

      // Create the event log data for ServiceTerminated event
      const topics = encodeEventTopics({
        abi: Abis.fwss,
        eventName: 'ServiceTerminated',
        args: {
          caller: ADDRESSES.client1,
          dataSetId,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'pdpRailId', type: 'uint256' },
          { name: 'cacheMissRailId', type: 'uint256' },
          { name: 'cdnRailId', type: 'uint256' },
        ],
        [pdpRailId, cacheMissRailId, cdnRailId]
      )

      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
            terminateService: () => [],
          },
          eth_getTransactionReceipt: (params) => {
            const [hash] = params
            return {
              hash,
              from: ADDRESSES.client1,
              to: calibration.contracts.fwss.address,
              contractAddress: null,
              index: 0,
              root: '0x0000000000000000000000000000000000000000000000000000000000000000',
              gasUsed: numberToHex(50000n),
              gasPrice: numberToHex(1000000000n),
              cumulativeGasUsed: numberToHex(50000n),
              effectiveGasPrice: numberToHex(1000000000n),
              logsBloom: `0x${'0'.repeat(512)}`,
              blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              blockNumber: numberToHex(1000000n),
              logs: [
                {
                  address: calibration.contracts.fwss.address,
                  topics,
                  data: eventData,
                  blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                  blockNumber: numberToHex(1000000n),
                  transactionHash: hash,
                  transactionIndex: numberToHex(0),
                  logIndex: numberToHex(0),
                  removed: false,
                },
              ],
              status: '0x1',
            }
          },
        })
      )

      const account = privateKeyToAccount(PRIVATE_KEYS.key1)
      const client = createWalletClient({
        account,
        chain: calibration,
        transport: http(),
      })

      const { receipt, event } = await terminateServiceSync(client, {
        dataSetId,
        onHash: (hash) => {
          onHashCalled = true
          receivedHash = hash
        },
      })

      assert.equal(onHashCalled, true)
      assert.ok(receivedHash)
      assert.ok(receipt)
      assert.equal(receipt.status, 'success')

      assert.ok(event)
      assert.equal(event.eventName, 'ServiceTerminated')
      assert.ok(event.args.caller)
      assert.equal(event.args.dataSetId, dataSetId)
      assert.equal(event.args.caller.toLowerCase(), ADDRESSES.client1.toLowerCase())
      if (event.eventName === 'ServiceTerminated') {
        assert.equal(event.args.pdpRailId, pdpRailId)
      }
      assert.equal(event.args.cacheMissRailId, cacheMissRailId)
      assert.equal(event.args.cdnRailId, cdnRailId)
    })

    it('should work without onHash callback', async () => {
      const dataSetId = 3n
      const pdpRailId = 15n
      const cacheMissRailId = 25n
      const cdnRailId = 35n

      const topics = encodeEventTopics({
        abi: Abis.fwss,
        eventName: 'ServiceTerminated',
        args: {
          caller: ADDRESSES.client1,
          dataSetId,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'pdpRailId', type: 'uint256' },
          { name: 'cacheMissRailId', type: 'uint256' },
          { name: 'cdnRailId', type: 'uint256' },
        ],
        [pdpRailId, cacheMissRailId, cdnRailId]
      )

      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
            terminateService: () => [],
          },
          eth_getTransactionReceipt: (params) => {
            const [hash] = params
            return {
              hash,
              from: ADDRESSES.client1,
              to: calibration.contracts.fwss.address,
              contractAddress: null,
              index: 0,
              root: '0x0000000000000000000000000000000000000000000000000000000000000000',
              gasUsed: numberToHex(50000n),
              gasPrice: numberToHex(1000000000n),
              cumulativeGasUsed: numberToHex(50000n),
              effectiveGasPrice: numberToHex(1000000000n),
              logsBloom: `0x${'0'.repeat(512)}`,
              blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              blockNumber: numberToHex(1000000n),
              logs: [
                {
                  address: calibration.contracts.fwss.address,
                  topics,
                  data: eventData,
                  blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                  blockNumber: numberToHex(1000000n),
                  transactionHash: hash,
                  transactionIndex: numberToHex(0),
                  logIndex: numberToHex(0),
                  removed: false,
                },
              ],
              status: '0x1',
            }
          },
        })
      )

      const account = privateKeyToAccount(PRIVATE_KEYS.key1)
      const client = createWalletClient({
        account,
        chain: calibration,
        transport: http(),
      })

      const { receipt, event } = await terminateServiceSync(client, {
        dataSetId,
      })

      assert.ok(receipt)
      assert.equal(receipt.status, 'success')

      assert.ok(event)
      assert.equal(event.eventName, 'ServiceTerminated')
      assert.equal(event.args.dataSetId, dataSetId)
    })
  })

  describe('extractTerminateServiceEvent', () => {
    it('should extract ServiceTerminated event from logs', () => {
      const dataSetId = 1n
      const pdpRailId = 10n
      const cacheMissRailId = 20n
      const cdnRailId = 30n

      const topics = encodeEventTopics({
        abi: Abis.fwss,
        eventName: 'ServiceTerminated',
        args: {
          caller: ADDRESSES.client1,
          dataSetId,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'pdpRailId', type: 'uint256' },
          { name: 'cacheMissRailId', type: 'uint256' },
          { name: 'cdnRailId', type: 'uint256' },
        ],
        [pdpRailId, cacheMissRailId, cdnRailId]
      )

      const logs: Log[] = [
        {
          address: calibration.contracts.fwss.address,
          topics: topics as [`0x${string}`, ...`0x${string}`[]],
          data: eventData,
          blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
          blockNumber: 1000000n,
          transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
          transactionIndex: 0,
          logIndex: 0,
          removed: false,
        },
      ]

      const event = extractTerminateServiceEvent(logs)

      assert.ok(event)
      assert.equal(event.eventName, 'ServiceTerminated')
      assert.equal(event.args.dataSetId, dataSetId)
      if (event.eventName === 'ServiceTerminated') {
        assert.equal(event.args.pdpRailId, pdpRailId)
      }
      assert.equal(event.args.cacheMissRailId, cacheMissRailId)
      assert.equal(event.args.cdnRailId, cdnRailId)
    })

    it('should throw error when ServiceTerminated event is not found', () => {
      const logs: any[] = []

      assert.throws(() => {
        extractTerminateServiceEvent(logs)
      }, /`ServiceTerminated` event not found/)
    })
  })
})
