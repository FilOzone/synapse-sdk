import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, parseUnits } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { accounts, accountsCall, parseAccounts } from '../src/pay/accounts.ts'

describe('accounts', () => {
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

  describe('accountsCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = accountsCall({
        chain: calibration,
        owner: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'accounts')
      assert.deepEqual(call.args, [calibration.contracts.usdfc.address, ADDRESSES.client1])
      assert.equal(call.address, calibration.contracts.payments.address)
      assert.equal(call.abi, calibration.contracts.payments.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = accountsCall({
        chain: mainnet,
        owner: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'accounts')
      assert.deepEqual(call.args, [mainnet.contracts.usdfc.address, ADDRESSES.client1])
      assert.equal(call.address, mainnet.contracts.payments.address)
      assert.equal(call.abi, mainnet.contracts.payments.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = accountsCall({
        chain: calibration,
        owner: ADDRESSES.client1,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })

    it('should use custom token when provided', () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd'
      const call = accountsCall({
        chain: calibration,
        owner: ADDRESSES.client1,
        token: customToken,
      })

      assert.deepEqual(call.args, [customToken, ADDRESSES.client1])
    })
  })

  describe('parseAccounts', () => {
    it('should parse contract output tuple into named object', () => {
      const contractOutput: [bigint, bigint, bigint, bigint] = [
        parseUnits('500', 18),
        parseUnits('100', 18),
        parseUnits('10', 18),
        1000000n,
      ]

      const result = parseAccounts(contractOutput, 1000000n)

      assert.equal(result.funds, parseUnits('500', 18))
      assert.equal(result.lockupCurrent, parseUnits('100', 18))
      assert.equal(result.lockupRate, parseUnits('10', 18))
      assert.equal(result.lockupLastSettledAt, 1000000n)
    })
  })

  describe('accounts (with mocked RPC)', () => {
    it('should fetch account info', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const accountInfo = await accounts(client, {
        owner: ADDRESSES.client1,
      })

      assert.equal(typeof accountInfo.funds, 'bigint')
      assert.equal(typeof accountInfo.lockupCurrent, 'bigint')
      assert.equal(typeof accountInfo.lockupRate, 'bigint')
      assert.equal(typeof accountInfo.lockupLastSettledAt, 'bigint')
    })

    it('should return expected mock values', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const accountInfo = await accounts(client, {
        owner: ADDRESSES.client1,
      })

      assert.equal(accountInfo.funds, parseUnits('500', 18))
      assert.equal(accountInfo.lockupCurrent, 0n)
      assert.equal(accountInfo.lockupRate, 0n)
      assert.equal(accountInfo.lockupLastSettledAt, 1000000n)
    })

    it('should use custom token address', async () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd'

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            accounts: (args) => {
              // Verify the custom token is passed through
              assert.equal(args[0].toLowerCase(), customToken.toLowerCase())
              return [parseUnits('100', 18), 0n, 0n, 500000n]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const accountInfo = await accounts(client, {
        owner: ADDRESSES.client1,
        token: customToken,
      })

      assert.equal(accountInfo.funds, parseUnits('100', 18))
    })
  })
})
