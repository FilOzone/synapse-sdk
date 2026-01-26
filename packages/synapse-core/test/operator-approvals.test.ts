import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { operatorApprovals, operatorApprovalsCall, parseOperatorApprovals } from '../src/pay/operator-approvals.ts'

describe('operatorApprovals', () => {
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

  describe('operatorApprovalsCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = operatorApprovalsCall({
        chain: calibration,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'operatorApprovals')
      assert.deepEqual(call.args, [
        calibration.contracts.usdfc.address,
        ADDRESSES.client1,
        calibration.contracts.storage.address,
      ])
      assert.equal(call.address, calibration.contracts.payments.address)
      assert.equal(call.abi, calibration.contracts.payments.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = operatorApprovalsCall({
        chain: mainnet,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'operatorApprovals')
      assert.deepEqual(call.args, [
        mainnet.contracts.usdfc.address,
        ADDRESSES.client1,
        mainnet.contracts.storage.address,
      ])
      assert.equal(call.address, mainnet.contracts.payments.address)
      assert.equal(call.abi, mainnet.contracts.payments.abi)
    })

    it('should use custom contract address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = operatorApprovalsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })

    it('should use custom token when provided', () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd'
      const call = operatorApprovalsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        token: customToken,
      })

      assert.equal(call.args[0], customToken)
    })

    it('should use custom operator when provided', () => {
      const customOperator = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      const call = operatorApprovalsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        operator: customOperator,
      })

      assert.equal(call.args[2], customOperator)
    })
  })

  describe('parseOperatorApprovals', () => {
    it('should parse contract output tuple into named object', () => {
      const contractOutput: [boolean, bigint, bigint, bigint, bigint, bigint] = [
        true,
        1000000n,
        10000000n,
        500000n,
        5000000n,
        86400n,
      ]

      const result = parseOperatorApprovals(contractOutput)

      assert.equal(result.isApproved, true)
      assert.equal(result.rateAllowance, 1000000n)
      assert.equal(result.lockupAllowance, 10000000n)
      assert.equal(result.rateUsage, 500000n)
      assert.equal(result.lockupUsage, 5000000n)
      assert.equal(result.maxLockupPeriod, 86400n)
    })

    it('should parse unapproved operator', () => {
      const contractOutput: [boolean, bigint, bigint, bigint, bigint, bigint] = [false, 0n, 0n, 0n, 0n, 0n]

      const result = parseOperatorApprovals(contractOutput)

      assert.equal(result.isApproved, false)
      assert.equal(result.rateAllowance, 0n)
      assert.equal(result.lockupAllowance, 0n)
      assert.equal(result.rateUsage, 0n)
      assert.equal(result.lockupUsage, 0n)
      assert.equal(result.maxLockupPeriod, 0n)
    })
  })

  describe('operatorApprovals (with mocked RPC)', () => {
    it('should fetch operator approval info', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const approval = await operatorApprovals(client, {
        address: ADDRESSES.client1,
      })

      assert.equal(typeof approval.isApproved, 'boolean')
      assert.equal(typeof approval.rateAllowance, 'bigint')
      assert.equal(typeof approval.lockupAllowance, 'bigint')
      assert.equal(typeof approval.rateUsage, 'bigint')
      assert.equal(typeof approval.lockupUsage, 'bigint')
      assert.equal(typeof approval.maxLockupPeriod, 'bigint')
    })

    it('should return expected mock values', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const approval = await operatorApprovals(client, {
        address: ADDRESSES.client1,
      })

      assert.equal(approval.isApproved, true)
      assert.equal(approval.rateAllowance, 1000000n)
      assert.equal(approval.lockupAllowance, 10000000n)
      assert.equal(approval.rateUsage, 500000n)
      assert.equal(approval.lockupUsage, 5000000n)
      assert.equal(approval.maxLockupPeriod, 86400n)
    })

    it('should use custom token address', async () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd'

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            operatorApprovals: (args) => {
              // Verify the custom token is passed through
              assert.equal(args[0].toLowerCase(), customToken.toLowerCase())
              return [true, 2000000n, 20000000n, 1000000n, 10000000n, 172800n]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const approval = await operatorApprovals(client, {
        address: ADDRESSES.client1,
        token: customToken,
      })

      assert.equal(approval.isApproved, true)
      assert.equal(approval.rateAllowance, 2000000n)
    })

    it('should use custom operator address', async () => {
      const customOperator = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            operatorApprovals: (args) => {
              // Verify the custom operator is passed through
              assert.equal(args[2].toLowerCase(), customOperator.toLowerCase())
              return [false, 0n, 0n, 0n, 0n, 0n]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const approval = await operatorApprovals(client, {
        address: ADDRESSES.client1,
        operator: customOperator,
      })

      assert.equal(approval.isApproved, false)
    })
  })
})
