import type { Simplify } from 'type-fest'
import type {
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  MulticallErrorType,
  ReadContractErrorType,
  Transport,
} from 'viem'
import { multicall, readContract } from 'viem/actions'
import type { serviceProviderRegistry as serviceProviderRegistryAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'
import { getApprovedProvidersCall } from '../warm-storage/get-approved-providers.ts'
import { getPDPProviderCall, parsePDPProvider } from './get-pdp-provider.ts'
import type { getProvidersByProductType } from './get-providers-by-product-type.ts'
import { type PDPProvider, PRODUCTS, type ProviderWithProduct } from './types.ts'

export namespace getPDPProviders {
  export type OptionsType = Omit<getProvidersByProductType.OptionsType, 'productType'>

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProvidersByProductType'
  >

  /** The paginated providers result */
  export type OutputType = { providers: PDPProvider[]; hasMore: boolean }

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get PDP providers with pagination
 *
 * @param client - The client to use to get the providers.
 * @param options - {@link getPDPProviders.OptionsType}
 * @returns The paginated providers result {@link getPDPProviders.OutputType}
 * @throws Errors {@link getPDPProviders.ErrorType}
 *
 * @example
 * ```ts
 * import { getPDPProviders } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const result = await getPDPProviders(client, {
 *   onlyActive: true,
 * })
 *
 * console.log(result.providers)
 * console.log(result.hasMore)
 * ```
 */
export async function getPDPProviders(
  client: Client<Transport, Chain>,
  options: getPDPProviders.OptionsType = {}
): Promise<getPDPProviders.OutputType> {
  const data = await readContract(
    client,
    getPDPProvidersCall({
      chain: client.chain,
      onlyActive: options.onlyActive,
      offset: options.offset,
      limit: options.limit,
      contractAddress: options.contractAddress,
    })
  )
  return parsePDPProviders(data)
}

export namespace getPDPProvidersCall {
  export type OptionsType = Simplify<getPDPProviders.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProvidersByProductType'
  >
}

/**
 * Create a call to the getPDPProviders function
 *
 * This function is used to create a call to the getPDPProviders function for use with the multicall or readContract function.
 *
 * @param options - {@link getPDPProvidersCall.OptionsType}
 * @returns The call to the getPDPProviders function {@link getPDPProvidersCall.OutputType}
 * @throws Errors {@link getPDPProvidersCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getPDPProvidersCall } from '@filoz/synapse-core/sp-registry'
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
 *     getPDPProvidersCall({
 *       chain: calibration,
 *       onlyActive: true,
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getPDPProvidersCall(options: getPDPProvidersCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'getProvidersByProductType',
    args: [PRODUCTS.PDP, options.onlyActive ?? true, options.offset ?? 0n, options.limit ?? 50n],
  } satisfies getPDPProvidersCall.OutputType
}

/**
 * Parse the contract output into a PDPProvider array
 *
 * @param data - The contract output from the getPDPProviders function {@link getPDPProviders.ContractOutputType}
 * @returns The PDPProvider array {@link getPDPProviders.OutputType}
 */
export function parsePDPProviders(data: getPDPProviders.ContractOutputType): getPDPProviders.OutputType {
  return {
    providers: data.providers.map(parsePDPProvider),
    hasMore: data.hasMore,
  }
}

export namespace getApprovedPDPProviders {
  export type OptionsType = Omit<getPDPProviders.OptionsType, 'onlyActive' | 'offset' | 'limit'>

  export type OutputType = PDPProvider[]

  export type ErrorType =
    | asChain.ErrorType
    | MulticallErrorType
    | getApprovedProvidersCall.ErrorType
    | getPDPProvidersCall.ErrorType
}

/**
 * Get FilecoinWarmStorage approved PDP providers
 *
 * @param client - The client to use to get the providers.
 * @param options - {@link getApprovedPDPProviders.OptionsType}
 * @returns The approved PDP providers {@link getApprovedPDPProviders.OutputType}
 * @throws Errors {@link getApprovedPDPProviders.ErrorType}
 *
 * @example
 * ```ts
 * import { getApprovedPDPProviders } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const result = await getApprovedPDPProviders(client)
 *
 * console.log(result)
 * ```
 */
export async function getApprovedPDPProviders(
  client: Client<Transport, Chain>,
  options: getApprovedPDPProviders.OptionsType = {}
): Promise<getApprovedPDPProviders.OutputType> {
  const [pdpProviders, approvedProviders] = await multicall(client, {
    allowFailure: false,
    contracts: [
      getPDPProvidersCall({
        chain: client.chain,
        onlyActive: true,
        offset: 0n,
        limit: 100n,
        contractAddress: options.contractAddress,
      }),
      getApprovedProvidersCall({
        chain: client.chain,
      }),
    ],
  })

  const providers = [] as ProviderWithProduct[]
  for (const provider of pdpProviders.providers) {
    if (approvedProviders.includes(provider.providerId)) {
      providers.push(provider)
    }
  }
  return parsePDPProviders({
    providers,
    hasMore: false,
  }).providers
}

export namespace getPDPProvidersByIds {
  export type OptionsType = {
    providerIds: bigint[]
    /** The contract address to use. If not provided, the default is the ServiceProviderRegistry contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = PDPProvider[]

  export type ErrorType =
    | asChain.ErrorType
    | MulticallErrorType
    | getApprovedProvidersCall.ErrorType
    | getPDPProvidersCall.ErrorType
}

/**
 * Get FilecoinWarmStorage approved PDP providers by IDs
 *
 * @param client - The client to use to get the providers.
 * @param options - {@link getPDPProvidersByIds.OptionsType}
 * @returns The approved PDP providers {@link getPDPProvidersByIds.OutputType}
 * @throws Errors {@link getPDPProvidersByIds.ErrorType}
 *
 * @example
 * ```ts
 * import { getPDPProvidersByIds } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const result = await getPDPProvidersByIds(client)
 *
 * console.log(result)
 * ```
 */
export async function getPDPProvidersByIds(
  client: Client<Transport, Chain>,
  options: getPDPProvidersByIds.OptionsType
): Promise<getPDPProvidersByIds.OutputType> {
  const result = await multicall(client, {
    allowFailure: true,
    contracts: options.providerIds.map((providerId) =>
      getPDPProviderCall({
        chain: client.chain,
        providerId,
        contractAddress: options.contractAddress,
      })
    ),
  })

  return parsePDPProviders({
    providers: result.filter((result) => result.status === 'success').map((result) => result.result),
    hasMore: false,
  }).providers
}
