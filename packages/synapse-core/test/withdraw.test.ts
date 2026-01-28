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
import { ValidationError } from '../src/errors/base.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { extractWithdrawEvent, withdraw, withdrawCall, withdrawSync } from '../src/pay/withdraw.ts'

// Type for captured args from withdraw mock
type WithdrawArgs = readonly [Address, bigint]

describe('withdraw', () => {
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

  describe('withdrawCall', () => {
    it('should create withdraw call with calibration chain defaults', () => {
      const call = withdrawCall({
        chain: calibration,
        amount: parseUnits('100', 18),
      })

      assert.equal(call.functionName, 'withdraw')
      assert.equal(call.address, calibration.contracts.filecoinPay.address)
      assert.equal(call.abi, calibration.contracts.filecoinPay.abi)

      // Check args: [token, amount]
      assert.equal(call.args[0], calibration.contracts.usdfc.address) // token
      assert.equal(call.args[1], parseUnits('100', 18)) // amount
    })

    it('should create call with mainnet chain defaults', () => {
      const call = withdrawCall({
        chain: mainnet,
        amount: parseUnits('50', 18),
      })

      assert.equal(call.functionName, 'withdraw')
      assert.equal(call.address, mainnet.contracts.filecoinPay.address)
      assert.equal(call.abi, mainnet.contracts.filecoinPay.abi)

      assert.equal(call.args[0], mainnet.contracts.usdfc.address)
      assert.equal(call.args[1], parseUnits('50', 18))
    })

    it('should use custom contract address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890' as Address
      const call = withdrawCall({
        chain: calibration,
        amount: parseUnits('100', 18),
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })

    it('should use custom token when provided', () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd' as Address
      const call = withdrawCall({
        chain: calibration,
        amount: parseUnits('100', 18),
        token: customToken,
      })

      assert.equal(call.args[0], customToken)
    })

    it('should throw ValidationError for zero amount', () => {
      assert.throws(
        () =>
          withdrawCall({
            chain: calibration,
            amount: 0n,
          }),
        ValidationError
      )
    })

    it('should throw ValidationError for negative amount', () => {
      assert.throws(
        () =>
          withdrawCall({
            chain: calibration,
            amount: -1n,
          }),
        ValidationError
      )
    })
  })

  describe('extractWithdrawEvent', () => {
    it('should throw when event is not found', () => {
      assert.throws(() => {
        extractWithdrawEvent([])
      }, /`WithdrawRecorded` event not found/)
    })

    it('should extract event from logs', () => {
      const withdrawAmount = parseUnits('100', 18)
      const topics = encodeEventTopics({
        abi: Abis.filecoinPay,
        eventName: 'WithdrawRecorded',
        args: {
          token: ADDRESSES.calibration.usdfcToken,
          from: ADDRESSES.client1,
          to: ADDRESSES.client1,
        },
      })

      const data = encodeAbiParameters([{ name: 'amount', type: 'uint256' }], [withdrawAmount])

      const logs: Log[] = [
        {
          address: calibration.contracts.filecoinPay.address,
          topics: topics as [`0x${string}`, ...`0x${string}`[]],
          data,
          blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
          blockNumber: 1000000n,
          transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
          transactionIndex: 0,
          logIndex: 0,
          removed: false,
        },
      ]

      const event = extractWithdrawEvent(logs)

      assert.equal(event.eventName, 'WithdrawRecorded')
      assert.equal(event.args.amount, withdrawAmount)
      assert.equal(event.args.from.toLowerCase(), ADDRESSES.client1.toLowerCase())
      assert.equal(event.args.to.toLowerCase(), ADDRESSES.client1.toLowerCase())
    })
  })

  describe('withdraw (with mocked RPC)', () => {
    it('should send withdraw transaction', async () => {
      let withdrawCalled = false
      let capturedArgs: WithdrawArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            withdraw: (args) => {
              withdrawCalled = true
              capturedArgs = args
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

      const hash = await withdraw(client, {
        amount: parseUnits('100', 18),
      })

      assert.equal(typeof hash, 'string')
      assert.ok(hash.startsWith('0x'))
      assert.equal(withdrawCalled, true)
      assert.ok(capturedArgs)
      assert.equal(capturedArgs[0].toLowerCase(), calibration.contracts.usdfc.address.toLowerCase()) // token
      assert.equal(capturedArgs[1], parseUnits('100', 18)) // amount
    })

    it('should use custom token', async () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd' as Address
      let capturedArgs: WithdrawArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            withdraw: (args) => {
              capturedArgs = args
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

      await withdraw(client, {
        amount: parseUnits('100', 18),
        token: customToken,
      })

      assert.ok(capturedArgs)
      assert.equal(capturedArgs[0].toLowerCase(), customToken.toLowerCase())
    })
  })

  describe('withdrawSync (with mocked RPC)', () => {
    it('should wait for confirmation and return receipt with event', async () => {
      let onHashCalled = false
      let receivedHash: string | undefined
      const withdrawAmount = parseUnits('100', 18)

      // Create the event log data for the receipt
      const topics = encodeEventTopics({
        abi: Abis.filecoinPay,
        eventName: 'WithdrawRecorded',
        args: {
          token: ADDRESSES.calibration.usdfcToken,
          from: ADDRESSES.client1,
          to: ADDRESSES.client1,
        },
      })

      const eventData = encodeAbiParameters([{ name: 'amount', type: 'uint256' }], [withdrawAmount])

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            withdraw: () => [],
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

      const { receipt, event } = await withdrawSync(client, {
        amount: withdrawAmount,
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
      assert.equal(event.eventName, 'WithdrawRecorded')
      assert.equal(event.args.amount, withdrawAmount)
    })
  })
})
