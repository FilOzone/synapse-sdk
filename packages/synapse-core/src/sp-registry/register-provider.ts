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
import { readContract, simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import type { serviceProviderRegistry as serviceProviderRegistryAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'
import { encodePDPCapabilities } from '../utils/pdp-capabilities.ts'
import type { PDPOffering } from './types.ts'

export namespace registerProvider {
  export type OptionsType = {
    /** The address that will receive payments for this provider */
    payee: Address
    /** The name of the service provider */
    name: string
    /** The description of the service provider */
    description: string
    /** The product type to register (0 for PDP). Defaults to 0. */
    productType?: number
    /** The PDP offering details */
    pdpOffering: PDPOffering
    /** Additional capabilities as key-value pairs. Optional. */
    capabilities?: Record<string, string>
    /** The registration fee value. If not provided, will be fetched from the contract. */
    value?: bigint
    /** Service provider registry contract address. If not provided, the default is the registry contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = registerProviderCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Register a new service provider in the Service Provider Registry
 *
 * Registers a new service provider with the specified information and PDP offering.
 * Requires a registration fee to be paid (typically 5 FIL).
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link registerProvider.OptionsType}
 * @returns The transaction hash {@link registerProvider.OutputType}
 * @throws Errors {@link registerProvider.ErrorType}
 *
 * @example
 * ```ts
 * import { registerProvider } from '@filoz/synapse-core/sp-registry'
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
 * const hash = await registerProvider(client, {
 *   payee: account.address,
 *   name: 'My Storage Provider',
 *   description: 'High-performance storage service',
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
export async function registerProvider(
  client: Client<Transport, Chain, Account>,
  options: registerProvider.OptionsType
): Promise<registerProvider.OutputType> {
  const chain = asChain(client.chain)
  const contractAddress = options.contractAddress ?? chain.contracts.serviceProviderRegistry.address

  // Get registration fee if not provided
  let registrationFee: bigint
  if (options.value !== undefined) {
    registrationFee = options.value
  } else {
    registrationFee = await readContract(client, {
      abi: chain.contracts.serviceProviderRegistry.abi,
      address: contractAddress,
      functionName: 'REGISTRATION_FEE',
    })
  }

  // Encode PDP capabilities
  const [capabilityKeys, capabilityValues] = encodePDPCapabilities(options.pdpOffering, options.capabilities)

  const { request } = await simulateContract(
    client,
    registerProviderCall({
      chain: client.chain,
      payee: options.payee,
      name: options.name,
      description: options.description,
      productType: options.productType ?? 0,
      capabilityKeys,
      capabilityValues,
      value: registrationFee,
      contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace registerProviderSync {
  export type OptionsType = registerProvider.OptionsType & {
    /** Callback function called with the transaction hash before waiting for the receipt. */
    onHash?: (hash: Hash) => void
  }

  export type OutputType = {
    /** The transaction receipt */
    receipt: Awaited<ReturnType<typeof waitForTransactionReceipt>>
    /** The extracted ProviderRegistered event */
    event: ReturnType<typeof extractRegisterProviderEvent>
  }

  export type ErrorType =
    | registerProviderCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Register a new service provider and wait for confirmation
 *
 * Registers a new service provider with the specified information and PDP offering.
 * Waits for the transaction to be confirmed and returns the receipt with the event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link registerProviderSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link registerProviderSync.OutputType}
 * @throws Errors {@link registerProviderSync.ErrorType}
 *
 * @example
 * ```ts
 * import { registerProviderSync } from '@filoz/synapse-core/sp-registry'
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
 * const { receipt, event } = await registerProviderSync(client, {
 *   payee: account.address,
 *   name: 'My Storage Provider',
 *   description: 'High-performance storage service',
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
 * console.log('Service Provider:', event.args.serviceProvider)
 * console.log('Payee:', event.args.payee)
 * ```
 */
export async function registerProviderSync(
  client: Client<Transport, Chain, Account>,
  options: registerProviderSync.OptionsType
): Promise<registerProviderSync.OutputType> {
  const hash = await registerProvider(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractRegisterProviderEvent(receipt.logs)

  return { receipt, event }
}

export namespace registerProviderCall {
  export type OptionsType = {
    /** The address that will receive payments for this provider */
    payee: Address
    /** The name of the service provider */
    name: string
    /** The description of the service provider */
    description: string
    /** The product type to register (0 for PDP) */
    productType: number
    /** The capability keys array */
    capabilityKeys: string[]
    /** The capability values array (as hex strings) */
    capabilityValues: readonly `0x${string}`[]
    /** The registration fee value */
    value: bigint
    /** Service provider registry contract address. If not provided, the default is the registry contract address for the chain. */
    contractAddress?: Address
    /** The chain to use for the contract call. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'payable',
    'registerProvider'
  > & {
    value: bigint
  }
}

/**
 * Create a call to the registerProvider function
 *
 * This function is used to create a call to the registerProvider function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link registerProviderCall.OptionsType}
 * @returns The call to the registerProvider function {@link registerProviderCall.OutputType}
 * @throws Errors {@link registerProviderCall.ErrorType}
 *
 * @example
 * ```ts
 * import { registerProviderCall } from '@filoz/synapse-core/sp-registry'
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
 * const { request } = await simulateContract(client, registerProviderCall({
 *   chain: calibration,
 *   payee: account.address,
 *   name: 'My Storage Provider',
 *   description: 'High-performance storage service',
 *   productType: 0,
 *   capabilityKeys,
 *   capabilityValues,
 *   value: parseEther('5'),
 * }))
 *
 * console.log(request)
 * ```
 */
export function registerProviderCall(options: registerProviderCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'registerProvider',
    args: [
      options.payee,
      options.name,
      options.description,
      options.productType,
      options.capabilityKeys,
      options.capabilityValues,
    ],
    value: options.value,
  } satisfies registerProviderCall.OutputType
}

/**
 * Extracts the ProviderRegistered event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ProviderRegistered event
 * @throws Error if the event is not found in the logs
 */
export function extractRegisterProviderEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.serviceProviderRegistry,
    logs,
    eventName: 'ProviderRegistered',
    strict: true,
  })
  if (!log) throw new Error('`ProviderRegistered` event not found.')
  return log
}
