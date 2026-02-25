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
    assert.equal(result.activeRailCount, 0)
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
    assert.equal(result.activeRailCount, 2)
  })

  it('should exclude terminated rails from lockup sum', async () => {
    const activeLockup = parseUnits('0.7', 18)
    const terminatedLockup = parseUnits('5', 18) // should be excluded

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

    // Only the active rail's lockupFixed should be counted
    assert.equal(result.totalFixedLockup, activeLockup)
    assert.equal(result.activeRailCount, 1)
  })

  it('should return zero when all rails are terminated', async () => {
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
    assert.equal(result.activeRailCount, 0)
  })
})
