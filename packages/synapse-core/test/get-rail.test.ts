import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, parseUnits } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getRail, getRailCall } from '../src/pay/get-rail.ts'

describe('getRail', () => {
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

  describe('getRailCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getRailCall({
        chain: calibration,
        railId: 1n,
      })

      assert.equal(call.functionName, 'getRail')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, calibration.contracts.filecoinPay.address)
      assert.equal(call.abi, calibration.contracts.filecoinPay.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getRailCall({
        chain: mainnet,
        railId: 2n,
      })

      assert.equal(call.functionName, 'getRail')
      assert.deepEqual(call.args, [2n])
      assert.equal(call.address, mainnet.contracts.filecoinPay.address)
      assert.equal(call.abi, mainnet.contracts.filecoinPay.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getRailCall({
        chain: calibration,
        railId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getRail (with mocked RPC)', () => {
    it('should fetch rail info', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const rail = await getRail(client, {
        railId: 1n,
      })

      assert.equal(typeof rail.token, 'string')
      assert.equal(typeof rail.from, 'string')
      assert.equal(typeof rail.to, 'string')
      assert.equal(typeof rail.operator, 'string')
      assert.equal(typeof rail.validator, 'string')
      assert.equal(typeof rail.paymentRate, 'bigint')
      assert.equal(typeof rail.lockupPeriod, 'bigint')
      assert.equal(typeof rail.lockupFixed, 'bigint')
      assert.equal(typeof rail.settledUpTo, 'bigint')
      assert.equal(typeof rail.endEpoch, 'bigint')
      assert.equal(typeof rail.commissionRateBps, 'bigint')
      assert.equal(typeof rail.serviceFeeRecipient, 'string')
    })

    it('should return expected mock values', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const rail = await getRail(client, {
        railId: 1n,
      })

      assert.equal(rail.from.toLowerCase(), ADDRESSES.client1.toLowerCase())
      assert.equal(rail.to.toLowerCase(), '0xaabbccddaabbccddaabbccddaabbccddaabbccdd')
      assert.equal(rail.operator, '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4')
      assert.equal(rail.paymentRate, parseUnits('1', 18))
      assert.equal(rail.settledUpTo, 1000000n)
      assert.equal(rail.endEpoch, 0n) // 0 = active rail
      assert.equal(rail.lockupPeriod, 2880n)
      assert.equal(rail.commissionRateBps, 500n)
    })

    it('should handle terminated rail (endEpoch > 0)', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            getRail: () => [
              {
                token: ADDRESSES.calibration.usdfcToken,
                from: ADDRESSES.client1,
                to: '0xaabbccddaabbccddaabbccddaabbccddaabbccdd',
                operator: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
                validator: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
                paymentRate: parseUnits('1', 18),
                lockupPeriod: 2880n,
                lockupFixed: 0n,
                settledUpTo: 1000000n,
                endEpoch: 2000000n, // > 0 means terminated
                commissionRateBps: 500n,
                serviceFeeRecipient: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
              },
            ],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const rail = await getRail(client, {
        railId: 1n,
      })

      assert.equal(rail.endEpoch, 2000000n)
      assert.ok(rail.endEpoch > 0n) // Terminated rail
    })
  })
})
