import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, parseUnits } from 'viem'
import { calibration } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getPriceList } from '../src/warm-storage/price-list.ts'

describe('getPriceList', () => {
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

  const makeClient = () => createPublicClient({ chain: calibration, transport: http() })

  it('reads rates and token live from getServicePrice', async () => {
    // Distinct values (not the defaults) prove these fields are plumbed from the
    // contract read rather than hardcoded in the adapter.
    const token = '0x00000000000000000000000000000000000000aa'
    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorage: {
          ...presets.basic.warmStorage,
          getServicePrice: () => [
            {
              pricePerTiBPerMonthNoCDN: parseUnits('9.9', 18),
              pricePerTiBCdnEgress: parseUnits('1.5', 18),
              pricePerTiBCacheMissEgress: parseUnits('2.5', 18),
              minimumPricePerMonth: parseUnits('6', 16),
              tokenAddress: token,
              epochsPerMonth: 86400n,
            },
          ],
        },
      })
    )

    const priceList = await getPriceList(makeClient())

    assert.equal(priceList.token.toLowerCase(), token)
    assert.equal(priceList.rates.storagePerTibPerMonth, parseUnits('9.9', 18))
    assert.equal(priceList.rates.cdnEgressPerTib, parseUnits('1.5', 18))
    assert.equal(priceList.rates.cacheMissEgressPerTib, parseUnits('2.5', 18))
  })

  it('supplies the dataset fee, which getServicePrice does not expose', async () => {
    server.use(JSONRPC(presets.basic))

    const priceList = await getPriceList(makeClient())

    // The current ABI has no dataset fee field, so the adapter must inject it.
    assert.equal(priceList.rates.datasetFeePerMonth, parseUnits('0.024', 18))
  })

  it('returns the on-chain PriceList key shape', async () => {
    server.use(JSONRPC(presets.basic))

    const priceList = await getPriceList(makeClient())

    assert.deepEqual(Object.keys(priceList).sort(), ['fees', 'lockups', 'rates', 'token'])
    assert.deepEqual(Object.keys(priceList.rates).sort(), [
      'cacheMissEgressPerTib',
      'cdnEgressPerTib',
      'datasetFeePerMonth',
      'storagePerTibPerMonth',
    ])
    assert.deepEqual(Object.keys(priceList.fees).sort(), [
      'addPiecesBaseFee',
      'addPiecesPerPieceFee',
      'createDataSetFee',
      'schedulePieceRemovalsFee',
      'terminateFee',
    ])
    assert.deepEqual(Object.keys(priceList.lockups).sort(), [
      'cacheMissLockupAmount',
      'cdnLockupAmount',
      'cdnLockupPeriod',
      'defaultLockupPeriod',
      'lifecycleReserveTarget',
      'replenishThreshold',
    ])
  })

  it('returns independent fee/lockup objects per call (callers cannot corrupt later reads)', async () => {
    server.use(JSONRPC(presets.basic))

    const first = await getPriceList(makeClient())
    first.fees.createDataSetFee = 0n
    first.lockups.lifecycleReserveTarget = 0n

    const second = await getPriceList(makeClient())
    assert.notEqual(second.fees.createDataSetFee, 0n)
    assert.notEqual(second.lockups.lifecycleReserveTarget, 0n)
  })
})
