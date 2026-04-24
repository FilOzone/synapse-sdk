/* globals describe it */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, maxUint256, parseUnits } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getAccountSummary } from '../src/pay/get-account-summary.ts'
import { TIME_CONSTANTS } from '../src/utils/constants.ts'

describe('getAccountSummary', () => {
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

  it('should return healthy summary with no rails', async () => {
    const funds = parseUnits('500', 18)

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [
            funds, // funds
            0n, // lockupCurrent
            0n, // lockupRate
            1000000n, // lockupLastSettledAt
          ],
          getRailsForPayerAndToken: () => [[], 0n, 0n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getAccountSummary(client, {
      address: ADDRESSES.client1,
      epoch: 1000000n,
    })

    assert.equal(result.funds, funds)
    assert.equal(result.availableFunds, funds)
    assert.equal(result.debt, 0n)
    assert.equal(result.lockupRatePerEpoch, 0n)
    assert.equal(result.lockupRatePerMonth, 0n)
    assert.equal(result.totalLockup, 0n)
    assert.equal(result.totalFixedLockup, 0n)
    assert.equal(result.totalRateBasedLockup, 0n)
    assert.equal(result.fundedUntilEpoch, maxUint256)
    assert.equal(result.runwayInEpochs, maxUint256)
    assert.equal(result.epoch, 1000000n)
  })

  it('should compute lockup breakdown with active rails', async () => {
    const funds = parseUnits('100', 18)
    const lockupRate = parseUnits('0.001', 18) // per epoch
    const lockupLastSettledAt = 1000000n
    const epoch = 1001000n // 1000 epochs elapsed
    const lockupFixed1 = parseUnits('0.7', 18)
    const lockupFixed2 = parseUnits('0.3', 18)

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [
            funds,
            0n, // lockupCurrent (settled at lockupLastSettledAt)
            lockupRate,
            lockupLastSettledAt,
          ],
          getRailsForPayerAndToken: () => [
            [
              { railId: 1n, isTerminated: false, endEpoch: 0n },
              { railId: 2n, isTerminated: false, endEpoch: 0n },
            ],
            2n,
            2n,
          ],
          getRail: (args) => {
            const railId = args[0]
            return [
              {
                ...presets.basic.payments.getRail(args)[0],
                lockupFixed: railId === 1n ? lockupFixed1 : lockupFixed2,
              },
            ]
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getAccountSummary(client, {
      address: ADDRESSES.client1,
      epoch,
    })

    assert.equal(result.funds, funds)
    assert.equal(result.lockupRatePerEpoch, lockupRate)
    assert.equal(result.lockupRatePerMonth, lockupRate * TIME_CONSTANTS.EPOCHS_PER_MONTH)
    assert.equal(result.debt, 0n)
    assert.equal(result.totalFixedLockup, lockupFixed1 + lockupFixed2)
    assert.equal(result.epoch, epoch)

    // totalLockup = funds - availableFunds
    assert.equal(result.totalLockup, funds - result.availableFunds)
    // totalRateBasedLockup = totalLockup - totalFixedLockup
    assert.equal(result.totalRateBasedLockup, result.totalLockup - result.totalFixedLockup)
    // runwayInEpochs = fundedUntilEpoch - epoch
    assert.equal(result.runwayInEpochs, result.fundedUntilEpoch - epoch)
  })

  it('should show debt when funds are insufficient', async () => {
    const funds = parseUnits('1', 18)
    const lockupRate = parseUnits('0.01', 18)
    const lockupLastSettledAt = 1000000n
    const epoch = 1010000n // 10000 epochs elapsed → 100 USDFC owed, only 1 available

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [funds, 0n, lockupRate, lockupLastSettledAt],
          getRailsForPayerAndToken: () => [[], 0n, 0n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getAccountSummary(client, {
      address: ADDRESSES.client1,
      epoch,
    })

    assert.equal(result.availableFunds, 0n)
    assert.ok(result.debt > 0n, 'should have debt')
    // fundedUntilEpoch should be before current epoch
    assert.ok(result.fundedUntilEpoch < epoch, 'funded until should be in the past')
    // runway is exhausted when account is insolvent
    assert.equal(result.runwayInEpochs, 0n)
  })

  it('should use provided epoch parameter', async () => {
    const customEpoch = 999999n

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [parseUnits('100', 18), 0n, 0n, customEpoch],
          getRailsForPayerAndToken: () => [[], 0n, 0n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getAccountSummary(client, {
      address: ADDRESSES.client1,
      epoch: customEpoch,
    })

    assert.equal(result.epoch, customEpoch)
  })
})
