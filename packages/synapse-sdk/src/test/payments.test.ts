/* globals describe it beforeEach before after */

/**
 * Tests for PaymentsService class
 */

import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { createWalletClient, parseUnits, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PaymentsService } from '../payments/index.ts'
import { TIME_CONSTANTS, TOKENS } from '../utils/index.ts'

// mock server for testing
const server = setup()

const walletClient = createWalletClient({
  chain: calibration,
  transport: viemHttp(),
  account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
})

describe('PaymentsService', () => {
  let payments: PaymentsService
  const paymentsAddress = Mocks.ADDRESSES.calibration.payments

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
    payments = new PaymentsService(walletClient)
  })

  describe('Instantiation', () => {
    it('should create instance with required parameters', () => {
      assert.exists(payments)
      assert.isFunction(payments.walletBalance)
      assert.isFunction(payments.balance)
      assert.isFunction(payments.deposit)
      assert.isFunction(payments.withdraw)
      assert.isFunction(payments.decimals)
    })
  })

  describe('walletBalance', () => {
    it('should return FIL balance when no token specified', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const balance = await payments.walletBalance()
      assert.equal(balance.toString(), parseUnits('100', 18).toString())
    })

    it('should return FIL balance when FIL token specified', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const balance = await payments.walletBalance(TOKENS.FIL)
      assert.equal(balance.toString(), parseUnits('100', 18).toString())
    })

    it('should return USDFC balance when USDFC specified', async () => {
      server.use(Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }))
      const balance = await payments.walletBalance(TOKENS.USDFC)
      assert.equal(balance.toString(), parseUnits('1000', 18).toString())
    })

    it('should throw for invalid token address', async () => {
      try {
        await payments.walletBalance('UNKNOWN' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }
    })
  })

  describe('balance', () => {
    it('should return USDFC balance from payments contract', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const balance = await payments.balance()
      // Should return available funds (500 USDFC - 0 locked = 500)
      assert.equal(balance.toString(), ethers.parseUnits('500', 18).toString())
    })

    it('should throw for non-USDFC token', async () => {
      try {
        await payments.balance('FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
        assert.include(error.message, 'USDFC')
      }
    })
  })

  describe('decimals', () => {
    it('should return 18 for USDFC', () => {
      assert.equal(payments.decimals(), 18)
    })

    it('should return 18 for any token', () => {
      assert.equal(payments.decimals('FIL' as any), 18)
    })
  })

  describe('Token operations', () => {
    it('should check allowance for USDFC', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const allowance = await payments.allowance(paymentsAddress)
      assert.equal(allowance.toString(), '0')
    })

    it('should approve token spending', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const amount = ethers.parseUnits('100', 18)
      const hash = await payments.approve(paymentsAddress, amount)
      assert.exists(hash)
      assert.typeOf(hash, 'string')
    })

    it('should throw for unsupported token in allowance', async () => {
      try {
        await payments.allowance('0x123', 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }
    })

    it('should throw for unsupported token in approve', async () => {
      try {
        await payments.approve('0x123', 100n, 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }
    })
  })

  describe('Service approvals', () => {
    const serviceAddress = '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4'

    it('should approve service as operator', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const rateAllowance = ethers.parseUnits('10', 18) // 10 USDFC per epoch
      const lockupAllowance = ethers.parseUnits('1000', 18) // 1000 USDFC lockup

      const hash = await payments.approveService(
        serviceAddress,
        rateAllowance,
        lockupAllowance,
        TIME_CONSTANTS.EPOCHS_PER_MONTH // 30 days max lockup period
      )
      assert.exists(hash)
      assert.typeOf(hash, 'string')
    })

    it('should revoke service operator approval', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const hash = await payments.revokeService(serviceAddress)
      assert.exists(hash)
      assert.typeOf(hash, 'string')
    })

    it('should check service approval status', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const approval = await payments.serviceApproval(serviceAddress)
      assert.exists(approval)
      assert.exists(approval.isApproved)
      assert.exists(approval.rateAllowance)
      assert.exists(approval.rateUsage)
      assert.exists(approval.lockupAllowance)
      assert.exists(approval.lockupUsage)
      assert.exists(approval.maxLockupPeriod)
    })

    it('should throw for unsupported token in service operations', async () => {
      try {
        await payments.approveService(serviceAddress, 100n, 1000n, TIME_CONSTANTS.EPOCHS_PER_MONTH, 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }

      try {
        await payments.revokeService(serviceAddress, 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }

      try {
        await payments.serviceApproval(serviceAddress, 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }
    })
  })

  describe('Error handling', () => {
    it('should throw errors from payment operations', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          eth_sendRawTransaction: () => {
            throw new Error('Transaction failed')
          },
        })
      )

      try {
        // Try deposit which uses sendTransaction
        await payments.deposit(ethers.parseUnits('100', 18))
        assert.fail('Should have thrown')
      } catch (error: any) {
        // Should get an error (either from signer or contract)
        assert.exists(error)
        assert.include(error.message, 'failed')
      }
    })
  })

  describe('Deposit and Withdraw', () => {
    it('should deposit USDFC tokens', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          erc20: {
            ...Mocks.presets.basic.erc20,
            balanceOf: () => [parseUnits('100', 18)],
            allowance: () => [parseUnits('100', 18)],
          },
        })
      )
      const depositAmount = parseUnits('100', 18)
      const hash = await payments.deposit(depositAmount)
      assert.exists(hash)
      assert.typeOf(hash, 'string')
    })

    it('should deposit with permit', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const depositAmount = parseUnits('10', 18)
      const hash = await payments.depositWithPermit(depositAmount)
      assert.exists(hash)
      assert.typeOf(hash, 'string')
    })

    it('should deposit with permit and approve operator', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const depositAmount = parseUnits('10', 18)
      const operator = '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4'
      const rateAllowance = parseUnits('5', 18)
      const lockupAllowance = parseUnits('100', 18)
      const maxLockupPeriod = 86400n

      const hash = await payments.depositWithPermitAndApproveOperator(
        depositAmount,
        operator,
        rateAllowance,
        lockupAllowance,
        maxLockupPeriod
      )
      assert.exists(hash)
      assert.typeOf(hash, 'string')
    })

    it('should withdraw USDFC tokens', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const withdrawAmount = parseUnits('50', 18)
      const hash = await payments.withdraw(withdrawAmount)
      assert.exists(hash)
      assert.typeOf(hash, 'string')
    })

    it('should throw for invalid deposit amount', async () => {
      try {
        await payments.deposit(0n)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Invalid amount')
      }
    })

    it('should throw for invalid withdraw amount', async () => {
      try {
        await payments.withdraw(0n)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Invalid amount')
      }
    })

    it('should throw for unsupported token in deposit', async () => {
      try {
        await payments.deposit(ethers.parseUnits('100', 18), 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Unsupported token')
      }
    })

    it('should throw for unsupported token in withdraw', async () => {
      try {
        await payments.withdraw(ethers.parseUnits('50', 18), 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Unsupported token')
      }
    })

    it('should handle deposit callbacks', async () => {
      let callCount = 0
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          erc20: {
            ...Mocks.presets.basic.erc20,
            balanceOf: () => [parseUnits('100', 18)],
            allowance: () => {
              callCount++
              if (callCount === 1) {
                return [parseUnits('0', 18)]
              }
              return [parseUnits('100', 18)]
            },
          },
        })
      )
      const depositAmount = ethers.parseUnits('100', 18)
      let allowanceChecked = false
      let approvalSent = false
      let depositStarted = false

      const tx = await payments.deposit(depositAmount, TOKENS.USDFC, {
        onAllowanceCheck: (current, required) => {
          allowanceChecked = true
          assert.equal(current, 0n)
          assert.equal(required, depositAmount)
        },
        onApprovalTransaction: (approveTx) => {
          approvalSent = true
          assert.typeOf(approveTx, 'string')
        },
        onApprovalConfirmed: (receipt) => {
          // This callback is called after approveTx.wait()
          assert.exists(receipt)
          assert.exists(receipt.status)
        },
        onDepositStarting: () => {
          depositStarted = true
        },
      })

      assert.exists(tx)
      assert.typeOf(tx, 'string')
      assert.isTrue(allowanceChecked)
      assert.isTrue(approvalSent)
      assert.isTrue(depositStarted)
    })
  })

  describe('Rail Settlement Features', () => {
    describe('getRailsAsPayer', () => {
      it('should return rails where wallet is payer', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const rails = await payments.getRailsAsPayer()
        assert.isArray(rails)
        assert.equal(rails.length, 2)
        assert.exists(rails[0].railId)
        assert.exists(rails[0].isTerminated)
        assert.exists(rails[0].endEpoch)
      })

      it('should throw for unsupported token', async () => {
        try {
          await payments.getRailsAsPayer('FIL' as any)
          assert.fail('Should have thrown')
        } catch (error: any) {
          assert.include(error.message, 'not supported')
        }
      })
    })

    describe('getRailsAsPayee', () => {
      it('should return rails where wallet is payee', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const rails = await payments.getRailsAsPayee()
        assert.isArray(rails)
        assert.equal(rails.length, 1)
        assert.exists(rails[0].railId)
        assert.exists(rails[0].isTerminated)
        assert.exists(rails[0].endEpoch)
      })

      it('should throw for unsupported token', async () => {
        try {
          await payments.getRailsAsPayee('FIL' as any)
          assert.fail('Should have thrown')
        } catch (error: any) {
          assert.include(error.message, 'not supported')
        }
      })
    })

    describe('settle', () => {
      it('should settle a rail up to current epoch', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        const tx = await payments.settle(railId)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })

      it('should settle a rail up to specific epoch', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        const untilEpoch = 999999n
        const tx = await payments.settle(railId, untilEpoch)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })

      it('should accept bigint rail ID', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        const tx = await payments.settle(railId)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })
    })

    describe('getSettlementAmounts', () => {
      it('should get settlement amounts for a rail', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        const result = await payments.getSettlementAmounts(railId)

        assert.exists(result)
        assert.exists(result.totalSettledAmount)
        assert.exists(result.totalNetPayeeAmount)
        assert.exists(result.totalOperatorCommission)
        assert.exists(result.finalSettledEpoch)
        assert.exists(result.note)

        // Check values from mock
        assert.equal(result.totalSettledAmount.toString(), ethers.parseUnits('100', 18).toString())
        assert.equal(result.totalNetPayeeAmount.toString(), ethers.parseUnits('95', 18).toString())
        assert.equal(result.totalOperatorCommission.toString(), ethers.parseUnits('5', 18).toString())
        assert.equal(result.finalSettledEpoch.toString(), '1000000')
        assert.equal(result.note, 'Settlement successful')
      })
    })

    describe('settleTerminatedRail', () => {
      it('should settle a terminated rail', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 456n
        const tx = await payments.settleTerminatedRail(railId)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })

      it('should accept bigint rail ID', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 456n
        const tx = await payments.settleTerminatedRail(railId)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })
    })

    describe('getRail', () => {
      it('should get detailed rail information', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        const rail = await payments.getRail(railId)

        assert.exists(rail)
        assert.exists(rail.token)
        assert.exists(rail.from)
        assert.exists(rail.to)
        assert.exists(rail.operator)
        assert.exists(rail.validator)
        assert.exists(rail.paymentRate)
        assert.exists(rail.lockupPeriod)
        assert.exists(rail.lockupFixed)
        assert.exists(rail.settledUpTo)
        assert.exists(rail.endEpoch)
        assert.exists(rail.commissionRateBps)
        assert.exists(rail.serviceFeeRecipient)

        // Check values from mock
        assert.equal(rail.from.toLowerCase(), Mocks.ADDRESSES.client1.toLowerCase())
        assert.equal(rail.to.toLowerCase(), '0xaabbccddaabbccddaabbccddaabbccddaabbccdd')
        assert.equal(rail.operator, '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4')
        assert.equal(rail.paymentRate.toString(), ethers.parseUnits('1', 18).toString())
        assert.equal(rail.settledUpTo.toString(), '1000000')
        assert.equal(rail.endEpoch.toString(), '0')
        assert.equal(rail.lockupPeriod.toString(), '2880')
        assert.equal(rail.commissionRateBps.toString(), '500')
      })

      it('should accept bigint rail ID', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        const rail = await payments.getRail(railId)

        assert.exists(rail)
        assert.exists(rail.from)
        assert.exists(rail.to)
      })
    })

    describe('settleAuto', () => {
      it('should settle active rail using regular settle', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        // This rail has endEpoch = 0 (active)
        const tx = await payments.settleAuto(railId)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })

      it('should settle terminated rail using settleTerminatedRail', async () => {
        const railId = 456n
        server.use(
          Mocks.JSONRPC({
            ...Mocks.presets.basic,
            payments: {
              ...Mocks.presets.basic.payments,
              getRail: (args) => {
                const [railIdArg] = args
                if (railIdArg === railId) {
                  return [
                    {
                      token: Mocks.ADDRESSES.calibration.usdfcToken,
                      from: Mocks.ADDRESSES.client1,
                      to: '0xaabbccddaabbccddaabbccddaabbccddaabbccdd',
                      operator: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
                      validator: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
                      paymentRate: ethers.parseUnits('1', 18),
                      lockupPeriod: 2880n,
                      lockupFixed: 0n,
                      settledUpTo: 1000000n,
                      endEpoch: 2000000n, // > 0 means terminated
                      commissionRateBps: 500n,
                      serviceFeeRecipient: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
                    },
                  ]
                }
                return Mocks.presets.basic.payments.getRail?.(args) ?? Mocks.presets.basic.payments.getRail(args)
              },
            },
          })
        )

        const tx = await payments.settleAuto(railId)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })

      it('should pass untilEpoch parameter to settle for active rails', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        const untilEpoch = 999999n
        const tx = await payments.settleAuto(railId, untilEpoch)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })

      it('should accept bigint rail ID', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const railId = 123n
        const tx = await payments.settleAuto(railId)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })

      it('should ignore untilEpoch for terminated rails', async () => {
        const railId = 456n
        server.use(
          Mocks.JSONRPC({
            ...Mocks.presets.basic,
            payments: {
              ...Mocks.presets.basic.payments,
              getRail: (args) => {
                const [railIdArg] = args
                if (railIdArg === railId) {
                  return [
                    {
                      token: Mocks.ADDRESSES.calibration.usdfcToken,
                      from: Mocks.ADDRESSES.client1,
                      to: '0xaabbccddaabbccddaabbccddaabbccddaabbccdd',
                      operator: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
                      validator: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
                      paymentRate: ethers.parseUnits('1', 18),
                      lockupPeriod: 2880n,
                      lockupFixed: 0n,
                      settledUpTo: 1000000n,
                      endEpoch: 2000000n, // > 0 means terminated
                      commissionRateBps: 500n,
                      serviceFeeRecipient: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
                    },
                  ]
                }
                return Mocks.presets.basic.payments.getRail?.(args) ?? Mocks.presets.basic.payments.getRail(args)
              },
            },
          })
        )

        // Pass untilEpoch, but it should be ignored for terminated rails
        const tx = await payments.settleAuto(railId, 999999n)

        assert.exists(tx)
        assert.typeOf(tx, 'string')
      })
    })
  })

  describe('Enhanced Payment Features', () => {
    describe('accountInfo', () => {
      it('should return detailed account information with correct fields', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const info = await payments.accountInfo()

        assert.exists(info.funds)
        assert.exists(info.lockupCurrent)
        assert.exists(info.lockupRate)
        assert.exists(info.lockupLastSettledAt)
        assert.exists(info.availableFunds)

        // Check that funds is correct (500 USDFC)
        assert.equal(info.funds.toString(), ethers.parseUnits('500', 18).toString())
        // With no lockup, available funds should equal total funds
        assert.equal(info.availableFunds.toString(), info.funds.toString())
      })

      it('should calculate available funds correctly with time-based lockup', async () => {
        server.use(
          Mocks.JSONRPC({
            ...Mocks.presets.basic,
            eth_blockNumber: '0xf4240', // 1000000 in hex - matches lockupLastSettledAt calculation
            payments: {
              ...Mocks.presets.basic.payments,
              accounts: (_args) => {
                // args should be [token, owner]
                return [
                  ethers.parseUnits('500', 18), // funds
                  ethers.parseUnits('50', 18), // lockupCurrent
                  ethers.parseUnits('0.1', 18), // lockupRate
                  BigInt(1000000 - 100), // lockupLastSettledAt (100 epochs ago)
                ]
              },
            },
          })
        )

        const info = await payments.accountInfo()

        // lockupCurrent (50) + lockupRate (0.1) * epochs (100) = 50 + 10 = 60
        // availableFunds = 500 - 60 = 440
        const expectedAvailable = ethers.parseUnits('440', 18)

        assert.equal(info.availableFunds.toString(), expectedAvailable.toString())
      })

      it('should use accountInfo in balance() method', async () => {
        server.use(Mocks.JSONRPC(Mocks.presets.basic))
        const balance = await payments.balance()
        const info = await payments.accountInfo()

        assert.equal(balance.toString(), info.availableFunds.toString())
      })
    })
  })
})
