import type { Simplify } from 'type-fest'
import type {
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  ReadContractErrorType,
  Transport,
} from 'viem'
import { readContract } from 'viem/actions'
import type { fwssView as fwssViewAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getPriceList {
  export type OptionsType = {
    /** Warm storage view contract address. Defaults to the chain's view contract. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<typeof fwssViewAbi, 'pure' | 'view', 'getPriceList'>

  /**
   * The canonical warm storage price list. Matches the on-chain `PriceList`
   * struct from `FilecoinWarmStorageServiceStateView.getPriceList()`.
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

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Read the warm storage price list.
 *
 * Reads the `getPriceList()` view on `FilecoinWarmStorageServiceStateView`.
 *
 * @param client - The client to use to read the price list.
 * @param options - {@link getPriceList.OptionsType}
 * @returns The price list {@link getPriceList.OutputType}
 * @throws Errors {@link getPriceList.ErrorType}
 *
 * @example
 * ```ts
 * import { getPriceList } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const priceList = await getPriceList(client)
 *
 * console.log(priceList.rates.storagePerTibPerMonth)
 * ```
 */
export async function getPriceList(
  client: Client<Transport, Chain>,
  options: getPriceList.OptionsType = {}
): Promise<getPriceList.OutputType> {
  const list = await readContract(
    client,
    getPriceListCall({
      chain: client.chain,
      contractAddress: options.contractAddress,
    })
  )

  // Map into a fresh object so callers can't corrupt later reads and the shape
  // is pinned to OutputType independent of the generated ABI tuple type.
  return {
    token: list.token,
    rates: {
      storagePerTibPerMonth: list.rates.storagePerTibPerMonth,
      datasetFeePerMonth: list.rates.datasetFeePerMonth,
      cdnEgressPerTib: list.rates.cdnEgressPerTib,
      cacheMissEgressPerTib: list.rates.cacheMissEgressPerTib,
    },
    fees: {
      createDataSetFee: list.fees.createDataSetFee,
      addPiecesBaseFee: list.fees.addPiecesBaseFee,
      addPiecesPerPieceFee: list.fees.addPiecesPerPieceFee,
      schedulePieceRemovalsFee: list.fees.schedulePieceRemovalsFee,
      terminateFee: list.fees.terminateFee,
    },
    lockups: {
      lifecycleReserveTarget: list.lockups.lifecycleReserveTarget,
      replenishThreshold: list.lockups.replenishThreshold,
      defaultLockupPeriod: list.lockups.defaultLockupPeriod,
      cdnLockupAmount: list.lockups.cdnLockupAmount,
      cacheMissLockupAmount: list.lockups.cacheMissLockupAmount,
      cdnLockupPeriod: list.lockups.cdnLockupPeriod,
    },
  }
}

export namespace getPriceListCall {
  export type OptionsType = Simplify<getPriceList.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof fwssViewAbi, 'pure' | 'view', 'getPriceList'>
}

/**
 * Create a call to the getPriceList function
 *
 * This function is used to create a call to the getPriceList function for use with the multicall or readContract function.
 *
 * @param options - {@link getPriceListCall.OptionsType}
 * @returns The call to the getPriceList function {@link getPriceListCall.OutputType}
 * @throws Errors {@link getPriceListCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getPriceListCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const results = await multicall(client, {
 *   contracts: [
 *     getPriceListCall({ chain: calibration }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getPriceListCall(options: getPriceListCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'getPriceList',
    args: [],
  } satisfies getPriceListCall.OutputType
}
