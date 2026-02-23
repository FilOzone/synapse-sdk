import assert from 'assert'
import { type Address, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { PRIVATE_KEYS } from '../src/mocks/jsonrpc/index.ts'
import { depositAndApprove } from '../src/pay/payments.ts'

describe('depositAndApprove', () => {
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
      await assert.rejects(
        () =>
          depositAndApprove(client, {
            amount: 1000n,
          }),
        (err: Error) => {
          assert.ok(!err.message.includes('Custom operator requires explicit'))
          return true
        }
      )
    })
  })
})
