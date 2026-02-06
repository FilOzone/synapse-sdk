import type { Simplify } from 'type-fest'
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
import { simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import type { fwss as storageAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'

export namespace terminateService {
  export type OptionsType = {
    /** The ID of the data set to terminate. */
    dataSetId: bigint
    /** Warm storage contract address. If not provided, the default is the storage contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = asChain.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Terminate a service (data set)
 *
 * This function terminates a data set service, which will also result in the removal of all pieces in the data set.
 *
 * @param client - The client to use to terminate the service.
 * @param options - {@link terminateService.OptionsType}
 * @returns The transaction hash {@link terminateService.OutputType}
 * @throws Errors {@link terminateService.ErrorType}
 *
 * @example
 * ```ts
 * import { terminateService } from '@filoz/synapse-core/warm-storage'
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
 * const txHash = await terminateService(client, {
 *   dataSetId: 1n,
 * })
 *
 * console.log(txHash)
 * ```
 */
export async function terminateService(
  client: Client<Transport, Chain, Account>,
  options: terminateService.OptionsType
): Promise<terminateService.OutputType> {
  const { request } = await simulateContract(
    client,
    terminateServiceCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace terminateServiceSync {
  export type OptionsType = Simplify<terminateService.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractTerminateServiceEvent>
  export type ErrorType =
    | terminateServiceCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Terminate a service (data set) and wait for confirmation
 *
 * This function terminates a data set service, which will also result in the removal of all pieces in the data set.
 * Waits for the transaction to be confirmed and returns the receipt with the ServiceTerminated event.
 *
 * @param client - The client to use to terminate the service.
 * @param options - {@link terminateServiceSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link terminateServiceSync.OutputType}
 * @throws Errors {@link terminateServiceSync.ErrorType}
 *
 * @example
 * ```ts
 * import { terminateServiceSync } from '@filoz/synapse-core/warm-storage'
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
 * const { receipt, event } = await terminateServiceSync(client, {
 *   dataSetId: 1n,
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Data set ID:', event.args.dataSetId)
 * ```
 */
export async function terminateServiceSync(
  client: Client<Transport, Chain, Account>,
  options: terminateServiceSync.OptionsType
): Promise<terminateServiceSync.OutputType> {
  const hash = await terminateService(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractTerminateServiceEvent(receipt.logs)

  return { receipt, event }
}

export namespace terminateServiceCall {
  export type OptionsType = Simplify<terminateService.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageAbi, 'nonpayable', 'terminateService'>
}

/**
 * Create a call to the {@link terminateService} function
 *
 * This function is used to create a call to the terminateService function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link terminateServiceCall.OptionsType}
 * @returns The call to the terminateService function {@link terminateServiceCall.OutputType}
 * @throws Errors {@link terminateServiceCall.ErrorType}
 *
 * @example
 * ```ts
 * import { terminateServiceCall } from '@filoz/synapse-core/warm-storage'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { simulateContract, writeContract } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const { request } = await simulateContract(client, terminateServiceCall({
 *   chain: calibration,
 *   dataSetId: 1n,
 * }))
 *
 * const hash = await writeContract(client, request)
 * console.log(hash)
 * ```
 */
export function terminateServiceCall(options: terminateServiceCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwss.abi,
    address: options.contractAddress ?? chain.contracts.fwss.address,
    functionName: 'terminateService',
    args: [options.dataSetId],
  } satisfies terminateServiceCall.OutputType
}

/**
 * Extracts the ServiceTerminated event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ServiceTerminated event
 * @throws Error if the ServiceTerminated event is not found in the logs
 */
export function extractTerminateServiceEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.fwss,
    logs,
    eventName: 'ServiceTerminated',
    strict: true,
  })
  if (!log) throw new Error('`ServiceTerminated` event not found.')
  return log
}
