/* globals describe it */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, parseUnits } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { totalAccountLockup } from '../src/pay/total-account-lockup.ts'

describe('totalAccountLockup', () => {
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

  it('should return zero when there are no rails', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          getRailsForPayerAndToken: () => [[], 0n, 0n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await totalAccountLockup(client, {
      address: ADDRESSES.client1,
    })

    assert.equal(result.totalFixedLockup, 0n)
  })

  it('should sum lockupFixed across active rails', async () => {
    const lockupFixed1 = parseUnits('0.7', 18)
    const lockupFixed2 = parseUnits('0.3', 18)

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
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

    const result = await totalAccountLockup(client, {
      address: ADDRESSES.client1,
    })

    assert.equal(result.totalFixedLockup, lockupFixed1 + lockupFixed2)
  })

  it('should include terminated rails in lockup sum', async () => {
    const activeLockup = parseUnits('0.7', 18)
    const terminatedLockup = parseUnits('5', 18)

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          getRailsForPayerAndToken: () => [
            [
              { railId: 1n, isTerminated: false, endEpoch: 0n },
              { railId: 2n, isTerminated: true, endEpoch: 999999n },
            ],
            2n,
            2n,
          ],
          getRail: (args) => {
            const railId = args[0]
            return [
              {
                ...presets.basic.payments.getRail(args)[0],
                lockupFixed: railId === 1n ? activeLockup : terminatedLockup,
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

    const result = await totalAccountLockup(client, {
      address: ADDRESSES.client1,
    })

    // Both active and terminated rails count — terminated rails still hold locked funds until finalized
    assert.equal(result.totalFixedLockup, activeLockup + terminatedLockup)
  })

  it('should sum lockup when all rails are terminated', async () => {
    const lockup1 = parseUnits('3', 18)
    const lockup2 = parseUnits('2', 18)

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          getRailsForPayerAndToken: () => [
            [
              { railId: 1n, isTerminated: true, endEpoch: 999998n },
              { railId: 2n, isTerminated: true, endEpoch: 999999n },
            ],
            2n,
            2n,
          ],
          getRail: (args) => {
            const railId = args[0]
            return [
              {
                ...presets.basic.payments.getRail(args)[0],
                lockupFixed: railId === 1n ? lockup1 : lockup2,
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

    const result = await totalAccountLockup(client, {
      address: ADDRESSES.client1,
    })

    assert.equal(result.totalFixedLockup, lockup1 + lockup2)
  })
})
