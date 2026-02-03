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
import type { serviceProviderRegistry as serviceProviderRegistryAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'
import { encodePDPCapabilities } from '../utils/pdp-capabilities.ts'
import type { PDPOffering } from './types.ts'

export namespace addProduct {
  export type OptionsType = {
    /** The product type to add (0 for PDP). Defaults to 0. */
    productType?: number
    /** The PDP offering details */
    pdpOffering: PDPOffering
    /** Additional capabilities as key-value pairs. Optional. */
    capabilities?: Record<string, string>
    /** Service provider registry contract address. If not provided, the default is the registry contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = addProductCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Add a product to the service provider
 *
 * Adds a new product (e.g., PDP) to the calling provider's offerings with the
 * specified capabilities. Only the provider themselves can add products.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link addProduct.OptionsType}
 * @returns The transaction hash {@link addProduct.OutputType}
 * @throws Errors {@link addProduct.ErrorType}
 *
 * @example
 * ```ts
 * import { addProduct } from '@filoz/synapse-core/sp-registry'
 * import { createWalletClient, http, parseEther } from 'viem'
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
 * const hash = await addProduct(client, {
 *   pdpOffering: {
 *     serviceURL: 'https://provider.example.com',
 *     minPieceSizeInBytes: 1024n,
 *     maxPieceSizeInBytes: 1073741824n,
 *     storagePricePerTibPerDay: parseEther('0.1'),
 *     minProvingPeriodInEpochs: 2880n,
 *     location: 'us-east',
 *     paymentTokenAddress: '0x0000000000000000000000000000000000000000',
 *   },
 *   capabilities: { region: 'us-east', tier: 'premium' },
 * })
 *
 * console.log(hash)
 * ```
 */
export async function addProduct(
  client: Client<Transport, Chain, Account>,
  options: addProduct.OptionsType
): Promise<addProduct.OutputType> {
  // Encode PDP capabilities
  const [capabilityKeys, capabilityValues] = encodePDPCapabilities(options.pdpOffering, options.capabilities)

  const { request } = await simulateContract(
    client,
    addProductCall({
      chain: client.chain,
      productType: options.productType,
      capabilityKeys,
      capabilityValues,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace addProductSync {
  export type OptionsType = Simplify<addProduct.OptionsType & ActionSyncCallback>

  export type OutputType = ActionSyncOutput<typeof extractAddProductEvent>

  export type ErrorType =
    | addProductCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Add a product to the service provider and wait for confirmation
 *
 * Adds a new product to the calling provider's offerings and waits for the
 * transaction to be confirmed. Returns the receipt with the event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link addProductSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link addProductSync.OutputType}
 * @throws Errors {@link addProductSync.ErrorType}
 *
 * @example
 * ```ts
 * import { addProductSync } from '@filoz/synapse-core/sp-registry'
 * import { createWalletClient, http, parseEther } from 'viem'
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
 * const { receipt, event } = await addProductSync(client, {
 *   pdpOffering: {
 *     serviceURL: 'https://provider.example.com',
 *     minPieceSizeInBytes: 1024n,
 *     maxPieceSizeInBytes: 1073741824n,
 *     storagePricePerTibPerDay: parseEther('0.1'),
 *     minProvingPeriodInEpochs: 2880n,
 *     location: 'us-east',
 *     paymentTokenAddress: '0x0000000000000000000000000000000000000000',
 *   },
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Provider ID:', event.args.providerId)
 * console.log('Product Type:', event.args.productType)
 * ```
 */
export async function addProductSync(
  client: Client<Transport, Chain, Account>,
  options: addProductSync.OptionsType
): Promise<addProductSync.OutputType> {
  const hash = await addProduct(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractAddProductEvent(receipt.logs)

  return { receipt, event }
}

export namespace addProductCall {
  export type OptionsType = Simplify<
    Omit<addProduct.OptionsType, 'pdpOffering' | 'capabilities'> & {
      /** The capability keys array */
      capabilityKeys: string[]
      /** The capability values array (as hex strings) */
      capabilityValues: readonly `0x${string}`[]
    } & ActionCallChain
  >

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof serviceProviderRegistryAbi, 'nonpayable', 'addProduct'>
}

/**
 * Create a call to the addProduct function
 *
 * This function is used to create a call to the addProduct function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link addProductCall.OptionsType}
 * @returns The call to the addProduct function {@link addProductCall.OutputType}
 * @throws Errors {@link addProductCall.ErrorType}
 *
 * @example
 * ```ts
 * import { addProductCall } from '@filoz/synapse-core/sp-registry'
 * import { createWalletClient, http, parseEther } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { simulateContract } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { encodePDPCapabilities } from '@filoz/synapse-core/utils/pdp-capabilities'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const pdpOffering = {
 *   serviceURL: 'https://provider.example.com',
 *   minPieceSizeInBytes: 1024n,
 *   maxPieceSizeInBytes: 1073741824n,
 *   storagePricePerTibPerDay: parseEther('0.1'),
 *   minProvingPeriodInEpochs: 2880n,
 *   location: 'us-east',
 *   paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
 * }
 *
 * const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering)
 *
 * const { request } = await simulateContract(client, addProductCall({
 *   chain: calibration,
 *   productType: 0,
 *   capabilityKeys,
 *   capabilityValues,
 * }))
 *
 * console.log(request)
 * ```
 */
export function addProductCall(options: addProductCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'addProduct',
    args: [options.productType ?? 0, options.capabilityKeys, options.capabilityValues],
  } satisfies addProductCall.OutputType
}

/**
 * Extracts the ProductAdded event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ProductAdded event
 * @throws Error if the event is not found in the logs
 */
export function extractAddProductEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.serviceProviderRegistry,
    logs,
    eventName: 'ProductAdded',
    strict: true,
  })
  if (!log) throw new Error('`ProductAdded` event not found.')
  return log
}
