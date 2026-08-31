/* globals describe it */

import assert from 'assert'
import { maxUint256, parseUnits } from 'viem'
import { calculateUploadCosts } from '../src/utils/calculate-upload-costs.ts'
import type { getPriceList } from '../src/warm-storage/price-list.ts'

const priceList = {
  token: '0x0000000000000000000000000000000000000001',
  rates: {
    storagePerTibPerMonth: parseUnits('2.5', 18),
    datasetFeePerMonth: parseUnits('0.12', 18),
    cdnEgressPerTib: parseUnits('7', 18),
    cacheMissEgressPerTib: parseUnits('7', 18),
  },
  fees: {
    createDataSetFee: parseUnits('0.025', 18),
    addPiecesBaseFee: parseUnits('0.008', 18),
    addPiecesPerPieceFee: parseUnits('0.003', 18),
    schedulePieceRemovalsFee: parseUnits('0.007', 18),
    terminateFee: parseUnits('0.006', 18),
  },
  lockups: {
    lifecycleReserveTarget: parseUnits('0.5', 18),
    replenishThreshold: parseUnits('0.025', 18),
    defaultLockupPeriod: 86_400n,
    cdnLockupAmount: parseUnits('0.7', 18),
    cacheMissLockupAmount: parseUnits('0.3', 18),
    cdnLockupPeriod: 14_400n,
  },
} satisfies getPriceList.OutputType

const account = {
  currentLockupRate: 0n,
  debt: 0n,
  availableFunds: 0n,
  runwayInEpochs: maxUint256,
  fwssMaxApproved: true,
}

const newContext = {
  pieceSizes: [1_000n],
  withCDN: false,
  dataSet: null,
} satisfies calculateUploadCosts.ContextType

describe('calculateUploadCosts', () => {
  it('calculates a complete single-context upload result', () => {
    const result = calculateUploadCosts({
      contexts: [newContext],
      priceList,
      account,
      extraRunwayEpochs: 0n,
      bufferEpochs: 0n,
    })

    assert.ok(result.rates.perEpoch > 0n)
    assert.equal(result.fees.createDataSetFee, priceList.fees.createDataSetFee)
    assert.equal(result.fees.addPiecesFee, priceList.fees.addPiecesBaseFee + priceList.fees.addPiecesPerPieceFee)
    assert.equal(result.lockups.lifecycleLockup, priceList.lockups.lifecycleReserveTarget)
    assert.equal(result.depositNeeded, result.lockups.total)
    assert.equal(result.needsFwssMaxApproval, false)
    assert.equal(result.ready, false)
  })

  it('aggregates context costs while applying account debt only once', () => {
    const indebtedAccount = { ...account, debt: parseUnits('5', 18) }
    const single = calculateUploadCosts({
      contexts: [newContext],
      priceList,
      account: indebtedAccount,
      extraRunwayEpochs: 0n,
      bufferEpochs: 0n,
    })
    const double = calculateUploadCosts({
      contexts: [newContext, newContext],
      priceList,
      account: indebtedAccount,
      extraRunwayEpochs: 0n,
      bufferEpochs: 0n,
    })

    assert.equal(double.rates.perEpoch, single.rates.perEpoch * 2n)
    assert.equal(double.fees.total, single.fees.total * 2n)
    assert.equal(double.lockups.total, single.lockups.total * 2n)
    assert.equal(double.depositNeeded, single.depositNeeded + single.lockups.total)
  })

  it('aggregates conservative per-piece operation fees', () => {
    const result = calculateUploadCosts({
      contexts: [{ ...newContext, pieceSizes: [1_000n, 2_000n] }],
      priceList,
      account,
      extraRunwayEpochs: 0n,
      bufferEpochs: 0n,
    })

    assert.equal(result.fees.addPiecesFee, (priceList.fees.addPiecesBaseFee + priceList.fees.addPiecesPerPieceFee) * 2n)
  })

  it('is independent of context order', () => {
    const existingContext = {
      pieceSizes: [2_000n, 3_000n],
      withCDN: true,
      dataSet: {
        leafCount: 100n,
        lifecycleReserveBalance: priceList.lockups.lifecycleReserveTarget,
        pendingOneTimePayments: 0n,
      },
    } satisfies calculateUploadCosts.ContextType

    const first = calculateUploadCosts({
      contexts: [newContext, existingContext],
      priceList,
      account,
      extraRunwayEpochs: 10n,
      bufferEpochs: 0n,
    })
    const reversed = calculateUploadCosts({
      contexts: [existingContext, newContext],
      priceList,
      account,
      extraRunwayEpochs: 10n,
      bufferEpochs: 0n,
    })

    assert.deepEqual(reversed, first)
  })

  it('rejects an empty context list', () => {
    assert.throws(
      () => calculateUploadCosts({ contexts: [], priceList, account }),
      /contexts must contain at least one storage context/
    )
  })
})
