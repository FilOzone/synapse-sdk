import assert from 'assert'
import { setup } from 'iso-web/msw'
import { type Address, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { depositAndApprove } from '../src/pay/payments.ts'

describe('depositAndApprove', () => {
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

  const account = privateKeyToAccount(PRIVATE_KEYS.key1)
  const client = createWalletClient({
    account,
    chain: calibration,
    transport: http(),
  })

  describe('custom operator validation', () => {
    it('should throw ValidationError when custom operator is provided without allowances', async () => {
      const customOperator = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Address
      await assert.rejects(
        () =>
          depositAndApprove(client, {
            amount: 1000n,
            operator: customOperator,
          }),
        /Custom operator requires explicit rateAllowance, lockupAllowance and maxLockupPeriod/
      )
    })

    it('should throw ValidationError when custom operator has rateAllowance and lockupAllowance but not maxLockupPeriod', async () => {
      const customOperator = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Address
      await assert.rejects(
        () =>
          depositAndApprove(client, {
            amount: 1000n,
            operator: customOperator,
            rateAllowance: 1000n,
            lockupAllowance: 2000n,
          }),
        /Custom operator requires explicit rateAllowance, lockupAllowance and maxLockupPeriod/
      )
    })

    it('should NOT throw validation error when using default operator without allowances', async () => {
      server.use(JSONRPC(presets.basic))
      const hash = await depositAndApprove(client, {
        amount: 1000n,
      })
      assert.match(hash, /^0x[0-9a-f]{64}$/)
    })
  })
})
