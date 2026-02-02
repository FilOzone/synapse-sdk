import assert from 'assert'
import { setup } from 'iso-web/msw'
import {
  type Address,
  createWalletClient,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  http,
  type Log,
  numberToHex,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration, mainnet } from '../src/chains.ts'
import { approve, approveCall, approveSync, extractApproveEvent } from '../src/erc20/approve.ts'
import { AllowanceAmountError } from '../src/errors/erc20.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'

// Type for captured args from approve mock
type ApproveArgs = readonly [Address, bigint]

describe('approve', () => {
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

  describe('approveCall', () => {
    it('should create call with calibration chain defaults', () => {
      const amount = parseUnits('100', 18)
      const call = approveCall({
        chain: calibration,
        amount,
      })

      assert.equal(call.functionName, 'approve')
      assert.equal(call.address, calibration.contracts.usdfc.address)
      assert.equal(call.abi, erc20Abi)

      // Check args: [spender, amount]
      assert.equal(call.args[0], calibration.contracts.filecoinPay.address) // spender
      assert.equal(call.args[1], amount) // amount
    })

    it('should create call with mainnet chain defaults', () => {
      const amount = parseUnits('100', 18)
      const call = approveCall({
        chain: mainnet,
        amount,
      })

      assert.equal(call.functionName, 'approve')
      assert.equal(call.address, mainnet.contracts.usdfc.address)
      assert.equal(call.abi, erc20Abi)

      assert.equal(call.args[0], mainnet.contracts.filecoinPay.address)
      assert.equal(call.args[1], amount)
    })

    it('should use custom token when provided', () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd' as Address
      const call = approveCall({
        chain: calibration,
        amount: 100n,
        token: customToken,
      })

      assert.equal(call.address, customToken)
    })

    it('should use custom spender when provided', () => {
      const customSpender = '0x1234567890123456789012345678901234567890' as Address
      const call = approveCall({
        chain: calibration,
        amount: 100n,
        spender: customSpender,
      })

      assert.equal(call.args[0], customSpender)
    })

    it('should throw error for negative amount', () => {
      assert.throws(() => {
        approveCall({
          chain: calibration,
          amount: -1n,
        })
      }, AllowanceAmountError)
    })
  })

  describe('extractApproveEvent', () => {
    it('should throw when event is not found', () => {
      assert.throws(() => {
        extractApproveEvent([])
      }, /`Approval` event not found/)
    })

    it('should extract event from logs', () => {
      const owner = ADDRESSES.client1
      const spender = calibration.contracts.filecoinPay.address
      const value = parseUnits('100', 18)

      const topics = encodeEventTopics({
        abi: erc20Abi,
        eventName: 'Approval',
        args: {
          owner,
          spender,
        },
      })

      // Approval event has no non-indexed arguments in data (value is not indexed? Wait, checking standard)
      // Standard ERC20: event Approval(address indexed owner, address indexed spender, uint256 value);
      // So value is in data.
      const data = encodeAbiParameters([{ name: 'value', type: 'uint256' }], [value])

      const logs: Log[] = [
        {
          address: calibration.contracts.usdfc.address,
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

      const event = extractApproveEvent(logs)

      assert.equal(event.eventName, 'Approval')
      assert.equal(event.args.owner, owner)
      assert.equal(event.args.spender, spender)
      assert.equal(event.args.value, value)
    })
  })

  describe('approve (with mocked RPC)', () => {
    it('should send approve transaction', async () => {
      let approveCalled = false
      let capturedArgs: ApproveArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          erc20: {
            ...presets.basic.erc20,
            approve: (args) => {
              approveCalled = true
              capturedArgs = args
              return [true]
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

      const amount = parseUnits('100', 18)
      const hash = await approve(client, {
        amount,
      })

      assert.equal(typeof hash, 'string')
      assert.ok(hash.startsWith('0x'))
      assert.equal(approveCalled, true)
      assert.ok(capturedArgs)

      // args: [spender, value]
      assert.equal(capturedArgs[0].toLowerCase(), calibration.contracts.filecoinPay.address.toLowerCase())
      assert.equal(capturedArgs[1], amount)
    })

    it('should use custom token and spender', async () => {
      const customToken = ADDRESSES.customToken
      const customSpender = '0x1234567890123456789012345678901234567890' as Address
      let capturedArgs: ApproveArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          erc20: {
            ...presets.basic.erc20,
            approve: (args) => {
              capturedArgs = args
              return [true]
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

      const amount = 500n
      await approve(client, {
        amount,
        token: customToken,
        spender: customSpender,
      })

      assert.ok(capturedArgs)
      assert.equal(capturedArgs[0].toLowerCase(), customSpender.toLowerCase())
      assert.equal(capturedArgs[1], amount)
    })
  })

  describe('approveSync (with mocked RPC)', () => {
    it('should wait for confirmation and return receipt with event', async () => {
      let onHashCalled = false
      let receivedHash: string | undefined

      const owner = ADDRESSES.client1
      const spender = calibration.contracts.filecoinPay.address
      const value = parseUnits('100', 18)

      // Create the event log data for the receipt
      const topics = encodeEventTopics({
        abi: erc20Abi,
        eventName: 'Approval',
        args: {
          owner,
          spender,
        },
      })

      const eventData = encodeAbiParameters([{ name: 'value', type: 'uint256' }], [value])

      server.use(
        JSONRPC({
          ...presets.basic,
          erc20: {
            ...presets.basic.erc20,
            approve: () => [true],
          },
          eth_getTransactionReceipt: (params) => {
            const [hash] = params
            return {
              hash,
              from: owner,
              to: calibration.contracts.usdfc.address,
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
                  address: calibration.contracts.usdfc.address,
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

      const { receipt, event } = await approveSync(client, {
        amount: value,
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
      assert.equal(event.eventName, 'Approval')
      assert.equal(event.args.owner, owner)
      assert.equal(event.args.spender, spender)
      assert.equal(event.args.value, value)
    })
  })
})
