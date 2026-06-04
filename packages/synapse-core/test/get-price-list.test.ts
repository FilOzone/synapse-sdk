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

  // A full PriceList with distinct values per field so a misplumbed field is
  // caught by an assertion rather than coinciding with another field's value.
  const distinctPriceList = {
    token: '0x00000000000000000000000000000000000000aa' as const,
    rates: {
      storagePerTibPerMonth: parseUnits('9.9', 18),
      datasetFeePerMonth: parseUnits('0.123', 18),
      cdnEgressPerTib: parseUnits('1.5', 18),
      cacheMissEgressPerTib: parseUnits('2.5', 18),
    },
    fees: {
      createDataSetFee: parseUnits('0.011', 18),
      addPiecesBaseFee: parseUnits('0.012', 18),
      addPiecesPerPieceFee: parseUnits('0.013', 18),
      schedulePieceRemovalsFee: parseUnits('0.014', 18),
      terminateFee: parseUnits('0.015', 18),
    },
    lockups: {
      lifecycleReserveTarget: parseUnits('0.21', 18),
      replenishThreshold: parseUnits('0.022', 18),
      defaultLockupPeriod: 1234n,
      cdnLockupAmount: parseUnits('0.23', 18),
      cacheMissLockupAmount: parseUnits('0.24', 18),
      cdnLockupPeriod: 5678n,
    },
  }

  const withPriceList = (list: typeof distinctPriceList) =>
    JSONRPC({
      ...presets.basic,
      warmStorageView: {
        ...presets.basic.warmStorageView,
        getPriceList: () => [list],
      },
    })

  it('plumbs every field from the on-chain getPriceList', async () => {
    server.use(withPriceList(distinctPriceList))

    const priceList = await getPriceList(makeClient())

    assert.equal(priceList.token.toLowerCase(), distinctPriceList.token)
    assert.deepEqual(priceList.rates, distinctPriceList.rates)
    assert.deepEqual(priceList.fees, distinctPriceList.fees)
    assert.deepEqual(priceList.lockups, distinctPriceList.lockups)
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
