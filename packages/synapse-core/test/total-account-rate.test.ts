/* globals describe it */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, parseUnits } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { totalAccountRate } from '../src/pay/total-account-rate.ts'
import { TIME_CONSTANTS } from '../src/utils/constants.ts'

describe('totalAccountRate', () => {
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

  it('should return zero rates when lockupRate is zero', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await totalAccountRate(client, {
      address: ADDRESSES.client1,
    })

    assert.equal(result.ratePerEpoch, 0n)
    assert.equal(result.ratePerMonth, 0n)
  })

  it('should return correct per-epoch and per-month rates', async () => {
    const lockupRate = parseUnits('1', 15) // 0.001 USDFC per epoch

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [
            parseUnits('500', 18), // funds
            0n, // lockupCurrent
            lockupRate, // lockupRate
            1000000n, // lockupLastSettledAt
          ],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await totalAccountRate(client, {
      address: ADDRESSES.client1,
    })

    assert.equal(result.ratePerEpoch, lockupRate)
    assert.equal(result.ratePerMonth, lockupRate * TIME_CONSTANTS.EPOCHS_PER_MONTH)
  })
})
