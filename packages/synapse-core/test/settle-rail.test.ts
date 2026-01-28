import assert from 'assert'
import { setup } from 'iso-web/msw'
import {
  type Address,
  createWalletClient,
  encodeAbiParameters,
  encodeEventTopics,
  http,
  type Log,
  numberToHex,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Abis from '../src/abis/index.ts'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { extractSettleRailEvent, settleRail, settleRailCall, settleRailSync } from '../src/pay/settle-rail.ts'

// Type for captured args from settleRail mock
type SettleRailArgs = readonly [bigint, bigint]

describe('settleRail', () => {
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

  describe('settleRailCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = settleRailCall({
        chain: calibration,
        railId: 1n,
        untilEpoch: 1000n,
      })

      assert.equal(call.functionName, 'settleRail')
      assert.equal(call.address, calibration.contracts.filecoinPay.address)
      assert.equal(call.abi, calibration.contracts.filecoinPay.abi)

      // Check args: [railId, untilEpoch]
      assert.equal(call.args[0], 1n) // railId
      assert.equal(call.args[1], 1000n) // untilEpoch
    })

    it('should create call with mainnet chain defaults', () => {
      const call = settleRailCall({
        chain: mainnet,
        railId: 2n,
        untilEpoch: 2000n,
      })

      assert.equal(call.functionName, 'settleRail')
      assert.equal(call.address, mainnet.contracts.filecoinPay.address)
      assert.equal(call.abi, mainnet.contracts.filecoinPay.abi)

      assert.equal(call.args[0], 2n)
      assert.equal(call.args[1], 2000n)
    })

    it('should use custom contract address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890' as Address
      const call = settleRailCall({
        chain: calibration,
        railId: 1n,
        untilEpoch: 1000n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('extractSettleRailEvent', () => {
    it('should throw when event is not found', () => {
      assert.throws(() => {
        extractSettleRailEvent([])
      }, /`RailSettled` event not found/)
    })

    it('should extract event from logs', () => {
      const railId = 1n
      const totalSettledAmount = parseUnits('100', 18)
      const totalNetPayeeAmount = parseUnits('95', 18)
      const operatorCommission = parseUnits('3', 18)
      const networkFee = parseUnits('2', 18)
      const settledUpTo = 1000n

      const topics = encodeEventTopics({
        abi: Abis.filecoinPay,
        eventName: 'RailSettled',
        args: {
          railId,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'totalSettledAmount', type: 'uint256' },
          { name: 'totalNetPayeeAmount', type: 'uint256' },
          { name: 'operatorCommission', type: 'uint256' },
          { name: 'networkFee', type: 'uint256' },
          { name: 'settledUpTo', type: 'uint256' },
        ],
        [totalSettledAmount, totalNetPayeeAmount, operatorCommission, networkFee, settledUpTo]
      )

      const logs: Log[] = [
        {
          address: calibration.contracts.filecoinPay.address,
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

      const event = extractSettleRailEvent(logs)

      assert.equal(event.eventName, 'RailSettled')
      assert.equal(event.args.railId, railId)
      assert.equal(event.args.totalSettledAmount, totalSettledAmount)
      assert.equal(event.args.totalNetPayeeAmount, totalNetPayeeAmount)
      assert.equal(event.args.operatorCommission, operatorCommission)
      assert.equal(event.args.networkFee, networkFee)
      assert.equal(event.args.settledUpTo, settledUpTo)
    })
  })

  describe('settleRail (with mocked RPC)', () => {
    it('should send settleRail transaction', async () => {
      let settleRailCalled = false
      let capturedArgs: SettleRailArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            settleRail: (args) => {
              settleRailCalled = true
              capturedArgs = args
              return [
                parseUnits('100', 18), // totalSettledAmount
                parseUnits('95', 18), // totalNetPayeeAmount
                parseUnits('3', 18), // totalOperatorCommission
                parseUnits('2', 18), // totalNetworkFee
                1000n, // finalSettledEpoch
                '', // note
              ]
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

      const hash = await settleRail(client, {
        railId: 1n,
        untilEpoch: 1000n,
      })

      assert.equal(typeof hash, 'string')
      assert.ok(hash.startsWith('0x'))
      assert.equal(settleRailCalled, true)
      assert.ok(capturedArgs)
      assert.equal(capturedArgs[0], 1n) // railId
      assert.equal(capturedArgs[1], 1000n) // untilEpoch
    })

    it('should use current epoch when untilEpoch is not provided', async () => {
      let capturedArgs: SettleRailArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          eth_blockNumber: numberToHex(1500n),
          payments: {
            ...presets.basic.payments,
            settleRail: (args) => {
              capturedArgs = args
              return [parseUnits('100', 18), parseUnits('95', 18), parseUnits('3', 18), parseUnits('2', 18), 1500n, '']
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

      await settleRail(client, {
        railId: 1n,
      })

      assert.ok(capturedArgs)
      assert.equal(capturedArgs[0], 1n) // railId
      assert.equal(capturedArgs[1], 1500n) // untilEpoch (current epoch)
    })
  })

  describe('settleRailSync (with mocked RPC)', () => {
    it('should wait for confirmation and return receipt with event', async () => {
      let onHashCalled = false
      let receivedHash: string | undefined
      const railId = 1n
      const totalSettledAmount = parseUnits('100', 18)
      const totalNetPayeeAmount = parseUnits('95', 18)
      const operatorCommission = parseUnits('3', 18)
      const networkFee = parseUnits('2', 18)
      const settledUpTo = 1000n

      // Create the event log data for the receipt
      const topics = encodeEventTopics({
        abi: Abis.filecoinPay,
        eventName: 'RailSettled',
        args: {
          railId,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'totalSettledAmount', type: 'uint256' },
          { name: 'totalNetPayeeAmount', type: 'uint256' },
          { name: 'operatorCommission', type: 'uint256' },
          { name: 'networkFee', type: 'uint256' },
          { name: 'settledUpTo', type: 'uint256' },
        ],
        [totalSettledAmount, totalNetPayeeAmount, operatorCommission, networkFee, settledUpTo]
      )

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            settleRail: () => [
              totalSettledAmount,
              totalNetPayeeAmount,
              operatorCommission,
              networkFee,
              settledUpTo,
              '',
            ],
          },
          eth_getTransactionReceipt: (params) => {
            const [hash] = params
            return {
              hash,
              from: ADDRESSES.client1,
              to: calibration.contracts.filecoinPay.address,
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
                  address: calibration.contracts.filecoinPay.address,
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

      const { receipt, event } = await settleRailSync(client, {
        railId,
        untilEpoch: settledUpTo,
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
      assert.equal(event.eventName, 'RailSettled')
      assert.equal(event.args.railId, railId)
      assert.equal(event.args.totalSettledAmount, totalSettledAmount)
      assert.equal(event.args.totalNetPayeeAmount, totalNetPayeeAmount)
      assert.equal(event.args.operatorCommission, operatorCommission)
      assert.equal(event.args.networkFee, networkFee)
      assert.equal(event.args.settledUpTo, settledUpTo)
    })

    it('should work without onHash callback', async () => {
      const railId = 1n
      const totalSettledAmount = parseUnits('50', 18)
      const totalNetPayeeAmount = parseUnits('47.5', 18)
      const operatorCommission = parseUnits('1.5', 18)
      const networkFee = parseUnits('1', 18)
      const settledUpTo = 2000n

      const topics = encodeEventTopics({
        abi: Abis.filecoinPay,
        eventName: 'RailSettled',
        args: {
          railId,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'totalSettledAmount', type: 'uint256' },
          { name: 'totalNetPayeeAmount', type: 'uint256' },
          { name: 'operatorCommission', type: 'uint256' },
          { name: 'networkFee', type: 'uint256' },
          { name: 'settledUpTo', type: 'uint256' },
        ],
        [totalSettledAmount, totalNetPayeeAmount, operatorCommission, networkFee, settledUpTo]
      )

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            settleRail: () => [
              totalSettledAmount,
              totalNetPayeeAmount,
              operatorCommission,
              networkFee,
              settledUpTo,
              '',
            ],
          },
          eth_getTransactionReceipt: (params) => {
            const [hash] = params
            return {
              hash,
              from: ADDRESSES.client1,
              to: calibration.contracts.filecoinPay.address,
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
                  address: calibration.contracts.filecoinPay.address,
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

      const { receipt, event } = await settleRailSync(client, {
        railId,
        untilEpoch: settledUpTo,
      })

      assert.ok(receipt)
      assert.equal(receipt.status, 'success')

      assert.ok(event)
      assert.equal(event.args.railId, railId)
      assert.equal(event.args.totalSettledAmount, totalSettledAmount)
    })
  })
})
