import type {
  Account,
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  Hash,
  Log,
  SimulateContractErrorType,
  Transport,
  WaitForTransactionReceiptErrorType,
  WriteContractErrorType,
} from 'viem'
import { parseEventLogs } from 'viem'
import { getBlockNumber, simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import type { payments as paymentsAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'

export namespace settleRail {
  export type OptionsType = {
    /** The rail ID to settle */
    railId: bigint
    /** The epoch to settle up to. If not provided, the current epoch will be used. */
    untilEpoch?: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ErrorType = settleRailCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Settle a payment rail up to a specific epoch
 *
 * Settles accumulated payments for a rail, transferring funds from the payer to the payee.
 * The settlement can be done up to a specific epoch (must be <= current epoch).
 * If untilEpoch is not provided, it will settle up to the current epoch.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link settleRail.OptionsType}
 * @returns The transaction hash
 * @throws Errors {@link settleRail.ErrorType}
 *
 * @example
 * ```ts
 * import { settleRail } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Settle rail up to current epoch
 * const hash = await settleRail(client, {
 *   railId: 1n,
 * })
 *
 * // Settle rail up to a specific epoch
 * const hash2 = await settleRail(client, {
 *   railId: 1n,
 *   untilEpoch: 1000n,
 * })
 *
 * console.log(hash)
 * ```
 */
export async function settleRail(
  client: Client<Transport, Chain, Account>,
  options: settleRail.OptionsType
): Promise<Hash> {
  const untilEpoch =
    options.untilEpoch ??
    (await getBlockNumber(client, {
      cacheTime: 0,
    }))

  const { request } = await simulateContract(
    client,
    settleRailCall({
      chain: client.chain,
      railId: options.railId,
      untilEpoch,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace settleRailSync {
  export type OptionsType = settleRail.OptionsType & {
    /** Callback function called with the transaction hash before waiting for the receipt. */
    onHash?: (hash: Hash) => void
  }

  export type OutputType = {
    /** The transaction receipt */
    receipt: Awaited<ReturnType<typeof waitForTransactionReceipt>>
    /** The extracted RailSettled event */
    event: ReturnType<typeof extractSettleRailEvent>
  }

  export type ErrorType =
    | settleRailCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Settle a payment rail up to a specific epoch and wait for confirmation
 *
 * Settles accumulated payments for a rail and waits for the transaction to be confirmed.
 * Returns the receipt with the RailSettled event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link settleRailSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link settleRailSync.OutputType}
 * @throws Errors {@link settleRailSync.ErrorType}
 *
 * @example
 * ```ts
 * import { settleRailSync } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const { receipt, event } = await settleRailSync(client, {
 *   railId: 1n,
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Total settled amount:', event.args.totalSettledAmount)
 * console.log('Settled up to epoch:', event.args.settledUpTo)
 * ```
 */
export async function settleRailSync(
  client: Client<Transport, Chain, Account>,
  options: settleRailSync.OptionsType
): Promise<settleRailSync.OutputType> {
  const hash = await settleRail(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractSettleRailEvent(receipt.logs)

  return { receipt, event }
}

export namespace settleRailCall {
  export type OptionsType = {
    /** The rail ID to settle */
    railId: bigint
    /** The epoch to settle up to */
    untilEpoch: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
    /** The chain to use for the contract call. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'nonpayable', 'settleRail'>
}

/**
 * Create a call to the settleRail function
 *
 * This function is used to create a call to the settleRail function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link settleRailCall.OptionsType}
 * @returns The call to the settleRail function {@link settleRailCall.OutputType}
 * @throws Errors {@link settleRailCall.ErrorType}
 *
 * @example
 * ```ts
 * import { settleRailCall } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { simulateContract } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Use with simulateContract
 * const { request } = await simulateContract(client, settleRailCall({
 *   chain: calibration,
 *   railId: 1n,
 *   untilEpoch: 1000n,
 * }))
 *
 * console.log(request)
 * ```
 */
export function settleRailCall(options: settleRailCall.OptionsType): settleRailCall.OutputType {
  const chain = asChain(options.chain)

  return {
    abi: chain.contracts.payments.abi,
    address: options.contractAddress ?? chain.contracts.payments.address,
    functionName: 'settleRail',
    args: [options.railId, options.untilEpoch],
  } satisfies settleRailCall.OutputType
}

/**
 * Extracts the RailSettled event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The RailSettled event
 * @throws Error if the event is not found in the logs
 */
export function extractSettleRailEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.payments,
    logs,
    eventName: 'RailSettled',
    strict: true,
  })
  if (!log) throw new Error('`RailSettled` event not found.')
  return log
}
