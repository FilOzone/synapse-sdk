import assert from 'assert'
import { setup } from 'iso-web/msw'
import {
  type Address,
  createWalletClient,
  encodeAbiParameters,
  encodeEventTopics,
  http,
  type Log,
  maxUint256,
  numberToHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Abis from '../src/abis/index.ts'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  extractSetOperatorApprovalEvent,
  setOperatorApproval,
  setOperatorApprovalCall,
  setOperatorApprovalSync,
} from '../src/pay/set-operator-approval.ts'
import { LOCKUP_PERIOD } from '../src/utils/constants.ts'

// Type for captured args from setOperatorApproval mock
type SetOperatorApprovalArgs = readonly [Address, Address, boolean, bigint, bigint, bigint]

describe('setOperatorApproval', () => {
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

  describe('setOperatorApprovalCall', () => {
    it('should create call with calibration chain defaults when approving', () => {
      const call = setOperatorApprovalCall({
        chain: calibration,
        approve: true,
      })

      assert.equal(call.functionName, 'setOperatorApproval')
      assert.equal(call.address, calibration.contracts.payments.address)
      assert.equal(call.abi, calibration.contracts.payments.abi)

      // Check args: [token, operator, approved, rateAllowance, lockupAllowance, maxLockupPeriod]
      assert.equal(call.args[0], calibration.contracts.usdfc.address) // token
      assert.equal(call.args[1], calibration.contracts.storage.address) // operator
      assert.equal(call.args[2], true) // approved
      assert.equal(call.args[3], maxUint256) // rateAllowance
      assert.equal(call.args[4], maxUint256) // lockupAllowance
      assert.equal(call.args[5], LOCKUP_PERIOD) // maxLockupPeriod (30 days in epochs)
    })

    it('should create call with mainnet chain defaults when approving', () => {
      const call = setOperatorApprovalCall({
        chain: mainnet,
        approve: true,
      })

      assert.equal(call.functionName, 'setOperatorApproval')
      assert.equal(call.address, mainnet.contracts.payments.address)
      assert.equal(call.abi, mainnet.contracts.payments.abi)

      assert.equal(call.args[0], mainnet.contracts.usdfc.address)
      assert.equal(call.args[1], mainnet.contracts.storage.address)
      assert.equal(call.args[2], true)
      assert.equal(call.args[3], maxUint256)
      assert.equal(call.args[4], maxUint256)
      assert.equal(call.args[5], LOCKUP_PERIOD)
    })

    it('should create call with zero defaults when revoking', () => {
      const call = setOperatorApprovalCall({
        chain: calibration,
        approve: false,
      })

      assert.equal(call.functionName, 'setOperatorApproval')
      assert.equal(call.args[2], false) // approved
      assert.equal(call.args[3], 0n) // rateAllowance
      assert.equal(call.args[4], 0n) // lockupAllowance
      assert.equal(call.args[5], 0n) // maxLockupPeriod
    })

    it('should use custom contract address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890' as Address
      const call = setOperatorApprovalCall({
        chain: calibration,
        approve: true,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })

    it('should use custom token when provided', () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd' as Address
      const call = setOperatorApprovalCall({
        chain: calibration,
        approve: true,
        token: customToken,
      })

      assert.equal(call.args[0], customToken)
    })

    it('should use custom operator when provided', () => {
      const customOperator = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Address
      const call = setOperatorApprovalCall({
        chain: calibration,
        approve: true,
        operator: customOperator,
      })

      assert.equal(call.args[1], customOperator)
    })

    it('should use custom allowances when provided', () => {
      const call = setOperatorApprovalCall({
        chain: calibration,
        approve: true,
        rateAllowance: 1000000n,
        lockupAllowance: 5000000n,
        maxLockupPeriod: 172800n,
      })

      assert.equal(call.args[3], 1000000n)
      assert.equal(call.args[4], 5000000n)
      assert.equal(call.args[5], 172800n)
    })

    it('should allow custom allowances when revoking', () => {
      // Edge case: someone might want to revoke but keep some allowance
      const call = setOperatorApprovalCall({
        chain: calibration,
        approve: false,
        rateAllowance: 100n,
        lockupAllowance: 200n,
        maxLockupPeriod: 300n,
      })

      assert.equal(call.args[2], false)
      assert.equal(call.args[3], 100n)
      assert.equal(call.args[4], 200n)
      assert.equal(call.args[5], 300n)
    })
  })

  describe('extractSetOperatorApprovalEvent', () => {
    it('should throw when event is not found', () => {
      assert.throws(() => {
        extractSetOperatorApprovalEvent([])
      }, /`OperatorApprovalUpdated` event not found/)
    })

    it('should extract event from logs', () => {
      const topics = encodeEventTopics({
        abi: Abis.payments,
        eventName: 'OperatorApprovalUpdated',
        args: {
          token: ADDRESSES.calibration.usdfcToken,
          client: ADDRESSES.client1,
          operator: calibration.contracts.storage.address,
        },
      })

      const data = encodeAbiParameters(
        [
          { name: 'approved', type: 'bool' },
          { name: 'rateAllowance', type: 'uint256' },
          { name: 'lockupAllowance', type: 'uint256' },
          { name: 'maxLockupPeriod', type: 'uint256' },
        ],
        [true, maxUint256, maxUint256, LOCKUP_PERIOD]
      )

      const logs: Log[] = [
        {
          address: calibration.contracts.payments.address,
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

      const event = extractSetOperatorApprovalEvent(logs)

      assert.equal(event.eventName, 'OperatorApprovalUpdated')
      assert.equal(event.args.approved, true)
      assert.equal(event.args.rateAllowance, maxUint256)
      assert.equal(event.args.lockupAllowance, maxUint256)
      assert.equal(event.args.maxLockupPeriod, LOCKUP_PERIOD)
    })
  })

  describe('setOperatorApproval (with mocked RPC)', () => {
    it('should send approval transaction', async () => {
      let setOperatorApprovalCalled = false
      let capturedArgs: SetOperatorApprovalArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            setOperatorApproval: (args) => {
              setOperatorApprovalCalled = true
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

      const hash = await setOperatorApproval(client, {
        approve: true,
      })

      assert.equal(typeof hash, 'string')
      assert.ok(hash.startsWith('0x'))
      assert.equal(setOperatorApprovalCalled, true)
      assert.ok(capturedArgs)
      assert.equal(capturedArgs[0].toLowerCase(), calibration.contracts.usdfc.address.toLowerCase()) // token
      assert.equal(capturedArgs[1].toLowerCase(), calibration.contracts.storage.address.toLowerCase()) // operator
      assert.equal(capturedArgs[2], true) // approved
      assert.equal(capturedArgs[3], maxUint256) // rateAllowance
      assert.equal(capturedArgs[4], maxUint256) // lockupAllowance
      assert.equal(capturedArgs[5], LOCKUP_PERIOD) // maxLockupPeriod
    })

    it('should send revoke transaction with zero defaults', async () => {
      let capturedArgs: SetOperatorApprovalArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            setOperatorApproval: (args) => {
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

      const hash = await setOperatorApproval(client, {
        approve: false,
      })

      assert.equal(typeof hash, 'string')
      assert.ok(capturedArgs)
      assert.equal(capturedArgs[2], false) // approved
      assert.equal(capturedArgs[3], 0n) // rateAllowance
      assert.equal(capturedArgs[4], 0n) // lockupAllowance
      assert.equal(capturedArgs[5], 0n) // maxLockupPeriod
    })

    it('should use custom token and operator', async () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd' as Address
      const customOperator = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Address
      let capturedArgs: SetOperatorApprovalArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            setOperatorApproval: (args) => {
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

      await setOperatorApproval(client, {
        approve: true,
        token: customToken,
        operator: customOperator,
      })

      assert.ok(capturedArgs)
      assert.equal(capturedArgs[0].toLowerCase(), customToken.toLowerCase())
      assert.equal(capturedArgs[1].toLowerCase(), customOperator.toLowerCase())
    })

    it('should use custom allowances', async () => {
      let capturedArgs: SetOperatorApprovalArgs | undefined

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            setOperatorApproval: (args) => {
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

      await setOperatorApproval(client, {
        approve: true,
        rateAllowance: 1000000n,
        lockupAllowance: 5000000n,
        maxLockupPeriod: 172800n,
      })

      assert.ok(capturedArgs)
      assert.equal(capturedArgs[3], 1000000n)
      assert.equal(capturedArgs[4], 5000000n)
      assert.equal(capturedArgs[5], 172800n)
    })
  })

  describe('setOperatorApprovalSync (with mocked RPC)', () => {
    it('should wait for confirmation and return receipt with event', async () => {
      let onHashCalled = false
      let receivedHash: string | undefined

      // Create the event log data for the receipt
      const topics = encodeEventTopics({
        abi: Abis.payments,
        eventName: 'OperatorApprovalUpdated',
        args: {
          token: ADDRESSES.calibration.usdfcToken,
          client: ADDRESSES.client1,
          operator: calibration.contracts.storage.address,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'approved', type: 'bool' },
          { name: 'rateAllowance', type: 'uint256' },
          { name: 'lockupAllowance', type: 'uint256' },
          { name: 'maxLockupPeriod', type: 'uint256' },
        ],
        [true, maxUint256, maxUint256, LOCKUP_PERIOD]
      )

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            setOperatorApproval: () => [],
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

      const { receipt, event } = await setOperatorApprovalSync(client, {
        approve: true,
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
      assert.equal(event.eventName, 'OperatorApprovalUpdated')
      assert.equal(event.args.approved, true)
      assert.equal(event.args.rateAllowance, maxUint256)
      assert.equal(event.args.lockupAllowance, maxUint256)
      assert.equal(event.args.maxLockupPeriod, LOCKUP_PERIOD)
    })

    it('should work without onHash callback', async () => {
      const topics = encodeEventTopics({
        abi: Abis.payments,
        eventName: 'OperatorApprovalUpdated',
        args: {
          token: ADDRESSES.calibration.usdfcToken,
          client: ADDRESSES.client1,
          operator: calibration.contracts.storage.address,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'approved', type: 'bool' },
          { name: 'rateAllowance', type: 'uint256' },
          { name: 'lockupAllowance', type: 'uint256' },
          { name: 'maxLockupPeriod', type: 'uint256' },
        ],
        [false, 0n, 0n, 0n]
      )

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            setOperatorApproval: () => [],
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

      const { receipt, event } = await setOperatorApprovalSync(client, {
        approve: false,
      })

      assert.ok(receipt)
      assert.equal(receipt.status, 'success')

      assert.ok(event)
      assert.equal(event.args.approved, false)
      assert.equal(event.args.rateAllowance, 0n)
      assert.equal(event.args.lockupAllowance, 0n)
      assert.equal(event.args.maxLockupPeriod, 0n)
    })
  })

  describe('LOCKUP_PERIOD constant', () => {
    it('should be 30 days in epochs', () => {
      // 30 days * 24 hours * 60 minutes * 2 epochs per minute = 86400 epochs
      const expectedEpochs = 30n * 24n * 60n * 2n
      assert.equal(LOCKUP_PERIOD, expectedEpochs)
      assert.equal(LOCKUP_PERIOD, 86400n)
    })
  })
})
