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
import {
  extractSettleTerminatedRailWithoutValidationEvent,
  settleTerminatedRailWithoutValidation,
  settleTerminatedRailWithoutValidationCall,
  settleTerminatedRailWithoutValidationSync,
} from '../src/pay/settle-terminated-rail-without-validation.ts'

// Type for captured args from settleTerminatedRailWithoutValidation mock
type SettleTerminatedRailArgs = readonly [bigint]

describe('settleTerminatedRailWithoutValidation', () => {
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

  describe('settleTerminatedRailWithoutValidationCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = settleTerminatedRailWithoutValidationCall({
        chain: calibration,
        railId: 1n,
      })

      assert.equal(call.functionName, 'settleTerminatedRailWithoutValidation')
      assert.equal(call.address, calibration.contracts.payments.address)
      assert.equal(call.abi, calibration.contracts.payments.abi)

      // Check args: [railId]
      assert.equal(call.args[0], 1n) // railId
    })

    it('should create call with mainnet chain defaults', () => {
      const call = settleTerminatedRailWithoutValidationCall({
        chain: mainnet,
        railId: 2n,
      })

      assert.equal(call.functionName, 'settleTerminatedRailWithoutValidation')
      assert.equal(call.address, mainnet.contracts.payments.address)
      assert.equal(call.abi, mainnet.contracts.payments.abi)

      assert.equal(call.args[0], 2n)
    })

    it('should use custom contract address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890' as Address
      const call = settleTerminatedRailWithoutValidationCall({
        chain: calibration,
        railId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('extractSettleTerminatedRailWithoutValidationEvent', () => {
    it('should throw when event is not found', () => {
      assert.throws(() => {
        extractSettleTerminatedRailWithoutValidationEvent([])
      }, /`RailSettled` event not found/)
    })

    it('should extract event from logs', () => {
      const railId = 1n
      const totalSettledAmount = parseUnits('200', 18)
      const totalNetPayeeAmount = parseUnits('190', 18)
      const operatorCommission = parseUnits('8', 18)
      const networkFee = parseUnits('2', 18)
      const settledUpTo = 999999n

      const topics = encodeEventTopics({
        abi: Abis.payments,
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
          address: calibration.contracts.payments.address,
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

      const event = extractSettleTerminatedRailWithoutValidationEvent(logs)

      assert.equal(event.eventName, 'RailSettled')
      assert.equal(event.args.railId, railId)
      assert.equal(event.args.totalSettledAmount, totalSettledAmount)
      assert.equal(event.args.totalNetPayeeAmount, totalNetPayeeAmount)
      assert.equal(event.args.operatorCommission, operatorCommission)
      assert.equal(event.args.networkFee, networkFee)
      assert.equal(event.args.settledUpTo, settledUpTo)
    })
  })

  describe('settleTerminatedRailWithoutValidation (with mocked RPC)', () => {
    it('should send settleTerminatedRailWithoutValidation transaction', async () => {
      let settleTerminatedRailCalled = false
      let capturedArgs: SettleTerminatedRailArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            settleTerminatedRailWithoutValidation: (args) => {
              settleTerminatedRailCalled = true
              capturedArgs = args
              return [
                parseUnits('200', 18), // totalSettledAmount
                parseUnits('190', 18), // totalNetPayeeAmount
                parseUnits('10', 18), // totalOperatorCommission
                parseUnits('2', 18), // totalNetworkFee
                999999n, // finalSettledEpoch
                'Terminated rail settlement', // note
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

      const hash = await settleTerminatedRailWithoutValidation(client, {
        railId: 1n,
      })

      assert.equal(typeof hash, 'string')
      assert.ok(hash.startsWith('0x'))
      assert.equal(settleTerminatedRailCalled, true)
      assert.ok(capturedArgs)
      assert.equal(capturedArgs[0], 1n) // railId
    })
  })

  describe('settleTerminatedRailWithoutValidationSync (with mocked RPC)', () => {
    it('should wait for confirmation and return receipt with event', async () => {
      let onHashCalled = false
      let receivedHash: string | undefined
      const railId = 1n
      const totalSettledAmount = parseUnits('200', 18)
      const totalNetPayeeAmount = parseUnits('190', 18)
      const operatorCommission = parseUnits('8', 18)
      const networkFee = parseUnits('2', 18)
      const settledUpTo = 999999n

      // Create the event log data for the receipt
      const topics = encodeEventTopics({
        abi: Abis.payments,
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
            settleTerminatedRailWithoutValidation: () => [
              totalSettledAmount,
              totalNetPayeeAmount,
              operatorCommission,
              networkFee,
              settledUpTo,
              'Terminated rail settlement',
            ],
          },
          eth_getTransactionReceipt: (params) => {
            const [hash] = params
            return {
              hash,
              from: ADDRESSES.client1,
              to: calibration.contracts.payments.address,
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
                  address: calibration.contracts.payments.address,
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

      const { receipt, event } = await settleTerminatedRailWithoutValidationSync(client, {
        railId,
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
      const totalSettledAmount = parseUnits('150', 18)
      const totalNetPayeeAmount = parseUnits('142.5', 18)
      const operatorCommission = parseUnits('6', 18)
      const networkFee = parseUnits('1.5', 18)
      const settledUpTo = 888888n

      const topics = encodeEventTopics({
        abi: Abis.payments,
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
            settleTerminatedRailWithoutValidation: () => [
              totalSettledAmount,
              totalNetPayeeAmount,
              operatorCommission,
              networkFee,
              settledUpTo,
              'Terminated rail settlement',
            ],
          },
          eth_getTransactionReceipt: (params) => {
            const [hash] = params
            return {
              hash,
              from: ADDRESSES.client1,
              to: calibration.contracts.payments.address,
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
                  address: calibration.contracts.payments.address,
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

      const { receipt, event } = await settleTerminatedRailWithoutValidationSync(client, {
        railId,
      })

      assert.ok(receipt)
      assert.equal(receipt.status, 'success')

      assert.ok(event)
      assert.equal(event.args.railId, railId)
      assert.equal(event.args.totalSettledAmount, totalSettledAmount)
    })
  })
})
