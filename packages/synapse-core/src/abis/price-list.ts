/**
 * `getPriceList()` view fragment for `FilecoinWarmStorageServiceStateView`,
 * mirroring the on-chain `PriceList` struct from
 * [FilOzone/filecoin-services#501](https://github.com/FilOzone/filecoin-services/pull/501).
 *
 * TODO: remove this file and the `fwssView` merge in `abis/index.ts` once
 * `FILECOIN_SERVICES_GIT_REF` (`wagmi.config.ts`) points at a release whose
 * generated view ABI exposes `getPriceList`.
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
