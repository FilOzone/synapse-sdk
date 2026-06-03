import type { Address, Chain, Client, Transport } from 'viem'
import { getServicePrice } from './get-service-price.ts'

export namespace getPriceList {
  export type OptionsType = getServicePrice.OptionsType

  /**
   * The canonical warm storage price list. Matches the on-chain `PriceList`
   * struct from `FilecoinWarmStorageServiceStateView.getPriceList()`
   * ([filecoin-services#501](https://github.com/FilOzone/filecoin-services/issues/501)).
   * Amounts are in the token's smallest unit; rates are per-month (divide by
   * `EPOCHS_PER_MONTH` for per-epoch values).
   */
  export type OutputType = {
    token: Address
    rates: {
      storagePerTibPerMonth: bigint
      datasetFeePerMonth: bigint
      cdnEgressPerTib: bigint
      cacheMissEgressPerTib: bigint
    }
    fees: {
      createDataSetFee: bigint
      addPiecesBaseFee: bigint
      addPiecesPerPieceFee: bigint
      schedulePieceRemovalsFee: bigint
      terminateFee: bigint
    }
    lockups: {
      lifecycleReserveTarget: bigint
      replenishThreshold: bigint
      defaultLockupPeriod: bigint
      cdnLockupAmount: bigint
      cacheMissLockupAmount: bigint
      cdnLockupPeriod: bigint
    }
  }
}

/**
 * FWSS operation fees and lockup defaults, sourced from `PriceListUSDFC.sol`.
 * Storage, egress, and token come from the contract via {@link getServicePrice}.
 */
const expectedFees = {
  createDataSetFee: 25_000_000_000_000_000n,
  addPiecesBaseFee: 500_000_000_000_000n,
  addPiecesPerPieceFee: 300_000_000_000_000n,
  schedulePieceRemovalsFee: 2_000_000_000_000_000n,
  terminateFee: 1_120_000_000_000_000n,
} as const

const expectedLockups = {
  lifecycleReserveTarget: 100_000_000_000_000_000n,
  replenishThreshold: 5_000_000_000_000_000n,
  defaultLockupPeriod: 86_400n, // EPOCHS_PER_DAY * 30
  cdnLockupAmount: 700_000_000_000_000_000n,
  cacheMissLockupAmount: 300_000_000_000_000_000n,
  cdnLockupPeriod: 14_400n, // EPOCHS_PER_DAY * 5
} as const

const DATASET_FEE_PER_MONTH = 24_000_000_000_000_000n // $0.024

/**
 * Read pricing through the canonical SDK shape.
 *
 * Storage and egress rates and the token come from the contract via
 * {@link getServicePrice}. The proving (dataset) rate, operation fees, and
 * lockup amounts come from {@link expectedFees} / {@link expectedLockups}.
 */
export async function getPriceList(
  client: Client<Transport, Chain>,
  options: getPriceList.OptionsType = {}
): Promise<getPriceList.OutputType> {
  const servicePrice = await getServicePrice(client, options)

  return {
    token: servicePrice.tokenAddress,
    rates: {
      storagePerTibPerMonth: servicePrice.pricePerTiBPerMonthNoCDN,
      datasetFeePerMonth: DATASET_FEE_PER_MONTH,
      cdnEgressPerTib: servicePrice.pricePerTiBCdnEgress,
      cacheMissEgressPerTib: servicePrice.pricePerTiBCacheMissEgress,
    },
    // Spread so callers can't mutate the shared module-level constants.
    fees: { ...expectedFees },
    lockups: { ...expectedLockups },
  }
}
