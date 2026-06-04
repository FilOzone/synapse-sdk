/**
 * Standalone `getPriceList()` view fragment for
 * `FilecoinWarmStorageServiceStateView`.
 *
 * Mirrors the on-chain `PriceList` struct added in
 * [FilOzone/filecoin-services#501](https://github.com/FilOzone/filecoin-services/pull/501).
 * Kept separate from the wagmi-generated ABI so the price list can be read from
 * the chain without bumping the generated ABI ref onto an unreleased commit.
 *
 * TODO: remove this file and the `fwssView` merge in `abis/index.ts` once the
 * generated ABI ref (`FILECOIN_SERVICES_GIT_REF` in `wagmi.config.ts`) is bumped
 * to a release that includes `getPriceList`; the generated view ABI will expose
 * it directly.
 */
export const priceListAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'getPriceList',
    outputs: [
      {
        name: 'list',
        internalType: 'struct PriceList',
        type: 'tuple',
        components: [
          { name: 'token', internalType: 'contract IERC20', type: 'address' },
          {
            name: 'rates',
            internalType: 'struct PriceListRates',
            type: 'tuple',
            components: [
              { name: 'storagePerTibPerMonth', internalType: 'uint256', type: 'uint256' },
              { name: 'datasetFeePerMonth', internalType: 'uint256', type: 'uint256' },
              { name: 'cdnEgressPerTib', internalType: 'uint256', type: 'uint256' },
              { name: 'cacheMissEgressPerTib', internalType: 'uint256', type: 'uint256' },
            ],
          },
          {
            name: 'fees',
            internalType: 'struct PriceListFees',
            type: 'tuple',
            components: [
              { name: 'createDataSetFee', internalType: 'uint256', type: 'uint256' },
              { name: 'addPiecesBaseFee', internalType: 'uint256', type: 'uint256' },
              { name: 'addPiecesPerPieceFee', internalType: 'uint256', type: 'uint256' },
              { name: 'schedulePieceRemovalsFee', internalType: 'uint256', type: 'uint256' },
              { name: 'terminateFee', internalType: 'uint256', type: 'uint256' },
            ],
          },
          {
            name: 'lockups',
            internalType: 'struct PriceListLockups',
            type: 'tuple',
            components: [
              { name: 'lifecycleReserveTarget', internalType: 'uint256', type: 'uint256' },
              { name: 'replenishThreshold', internalType: 'uint256', type: 'uint256' },
              { name: 'defaultLockupPeriod', internalType: 'uint256', type: 'uint256' },
              { name: 'cdnLockupAmount', internalType: 'uint256', type: 'uint256' },
              { name: 'cacheMissLockupAmount', internalType: 'uint256', type: 'uint256' },
              { name: 'cdnLockupPeriod', internalType: 'uint256', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const
