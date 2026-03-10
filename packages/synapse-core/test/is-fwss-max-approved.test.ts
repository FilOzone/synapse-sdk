/* globals describe it */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, maxUint256 } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { isFwssMaxApproved } from '../src/pay/is-fwss-max-approved.ts'
import { LOCKUP_PERIOD } from '../src/utils/constants.ts'

describe('isFwssMaxApproved', () => {
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

  it('should return false when operator is not approved', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [false, 0n, 0n, 0n, 0n, 0n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await isFwssMaxApproved(client, {
      clientAddress: ADDRESSES.client1,
    })

    assert.equal(result, false)
  })

  it('should return false when approved but rateAllowance is not maxUint256', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, 1000000n, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await isFwssMaxApproved(client, {
      clientAddress: ADDRESSES.client1,
    })

    assert.equal(result, false)
  })

  it('should return false when approved but lockupAllowance is not maxUint256', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, 1000000n, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await isFwssMaxApproved(client, {
      clientAddress: ADDRESSES.client1,
    })

    assert.equal(result, false)
  })

  it('should return false when approved but maxLockupPeriod is below LOCKUP_PERIOD', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, LOCKUP_PERIOD - 1n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await isFwssMaxApproved(client, {
      clientAddress: ADDRESSES.client1,
    })

    assert.equal(result, false)
  })

  it('should return true when maxLockupPeriod equals LOCKUP_PERIOD', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, LOCKUP_PERIOD],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await isFwssMaxApproved(client, {
      clientAddress: ADDRESSES.client1,
    })

    assert.equal(result, true)
  })

  it('should return true when all allowances are maxUint256', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await isFwssMaxApproved(client, {
      clientAddress: ADDRESSES.client1,
    })

    assert.equal(result, true)
  })
})
