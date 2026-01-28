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
import { encodePDPCapabilities } from '../utils/pdp-capabilities.ts'
import type { PDPOffering } from './types.ts'

export namespace updateProduct {
  export type OptionsType = {
    /** The product type to update (0 for PDP). Defaults to 0. */
    productType?: number
    /** The PDP offering details */
    pdpOffering: PDPOffering
    /** Additional capabilities as key-value pairs. Optional. */
    capabilities?: Record<string, string>
    /** Service provider registry contract address. If not provided, the default is the registry contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = updateProductCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Update a product for the service provider
 *
 * Updates an existing product (e.g., PDP) for the calling provider with new
 * capabilities. Only the provider themselves can update their products.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link updateProduct.OptionsType}
 * @returns The transaction hash {@link updateProduct.OutputType}
 * @throws Errors {@link updateProduct.ErrorType}
 *
 * @example
 * ```ts
 * import { updateProduct } from '@filoz/synapse-core/sp-registry'
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
 * const hash = await updateProduct(client, {
 *   pdpOffering: {
 *     serviceURL: 'https://provider.example.com',
 *     minPieceSizeInBytes: 1024n,
 *     maxPieceSizeInBytes: 1073741824n,
 *     storagePricePerTibPerDay: parseEther('0.15'),
 *     minProvingPeriodInEpochs: 2880n,
 *     location: 'us-west',
 *     paymentTokenAddress: '0x0000000000000000000000000000000000000000',
 *   },
 *   capabilities: { region: 'us-west', tier: 'premium' },
 * })
 *
 * console.log(hash)
 * ```
 */
export async function updateProduct(
  client: Client<Transport, Chain, Account>,
  options: updateProduct.OptionsType
): Promise<updateProduct.OutputType> {
  // Encode PDP capabilities
  const [capabilityKeys, capabilityValues] = encodePDPCapabilities(options.pdpOffering, options.capabilities)

  const { request } = await simulateContract(
    client,
    updateProductCall({
      chain: client.chain,
      productType: options.productType,
      capabilityKeys,
      capabilityValues,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace updateProductSync {
  export type OptionsType = Simplify<
    updateProduct.OptionsType & {
      /** Callback function called with the transaction hash before waiting for the receipt. */
      onHash?: (hash: Hash) => void
    }
  >

  export type OutputType = {
    /** The transaction receipt */
    receipt: Awaited<ReturnType<typeof waitForTransactionReceipt>>
    /** The extracted ProductUpdated event */
    event: ReturnType<typeof extractUpdateProductEvent>
  }

  export type ErrorType =
    | updateProductCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Update a product for the service provider and wait for confirmation
 *
 * Updates an existing product for the calling provider and waits for the
 * transaction to be confirmed. Returns the receipt with the event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link updateProductSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link updateProductSync.OutputType}
 * @throws Errors {@link updateProductSync.ErrorType}
 *
 * @example
 * ```ts
 * import { updateProductSync } from '@filoz/synapse-core/sp-registry'
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
 * const { receipt, event } = await updateProductSync(client, {
 *   pdpOffering: {
 *     serviceURL: 'https://provider.example.com',
 *     minPieceSizeInBytes: 1024n,
 *     maxPieceSizeInBytes: 1073741824n,
 *     storagePricePerTibPerDay: parseEther('0.15'),
 *     minProvingPeriodInEpochs: 2880n,
 *     location: 'us-west',
 *     paymentTokenAddress: '0x0000000000000000000000000000000000000000',
 *   },
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Provider ID:', event.args.providerId)
 * console.log('Product Type:', event.args.productType)
 * ```
 */
export async function updateProductSync(
  client: Client<Transport, Chain, Account>,
  options: updateProductSync.OptionsType
): Promise<updateProductSync.OutputType> {
  const hash = await updateProduct(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractUpdateProductEvent(receipt.logs)

  return { receipt, event }
}

export namespace updateProductCall {
  export type OptionsType = Simplify<
    Omit<updateProduct.OptionsType, 'pdpOffering' | 'capabilities'> & {
      /** The capability keys array */
      capabilityKeys: string[]
      /** The capability values array (as hex strings) */
      capabilityValues: readonly `0x${string}`[]
      /** The chain to use for the contract call. */
      chain: Chain
    }
  >

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof serviceProviderRegistryAbi, 'nonpayable', 'updateProduct'>
}

/**
 * Create a call to the updateProduct function
 *
 * This function is used to create a call to the updateProduct function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link updateProductCall.OptionsType}
 * @returns The call to the updateProduct function {@link updateProductCall.OutputType}
 * @throws Errors {@link updateProductCall.ErrorType}
 *
 * @example
 * ```ts
 * import { updateProductCall } from '@filoz/synapse-core/sp-registry'
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
 *   storagePricePerTibPerDay: parseEther('0.15'),
 *   minProvingPeriodInEpochs: 2880n,
 *   location: 'us-west',
 *   paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
 * }
 *
 * const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering)
 *
 * const { request } = await simulateContract(client, updateProductCall({
 *   chain: calibration,
 *   capabilityKeys,
 *   capabilityValues,
 * }))
 *
 * console.log(request)
 * ```
 */
export function updateProductCall(options: updateProductCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'updateProduct',
    args: [options.productType ?? 0, options.capabilityKeys, options.capabilityValues],
  } satisfies updateProductCall.OutputType
}

/**
 * Extracts the ProductUpdated event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ProductUpdated event
 * @throws Error if the event is not found in the logs
 */
export function extractUpdateProductEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.serviceProviderRegistry,
    logs,
    eventName: 'ProductUpdated',
    strict: true,
  })
  if (!log) throw new Error('`ProductUpdated` event not found.')
  return log
}
