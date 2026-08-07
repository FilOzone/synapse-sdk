import type {
  Address,
  Chain,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  MulticallErrorType,
  ReadContractErrorType,
} from 'viem'
import { multicall, readContract } from 'viem/actions'
import type { serviceProviderRegistry as serviceProviderRegistryAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import { type Page, type PaginationOptions, paginate, resolvePagination } from '../pagination.ts'
import type { PaginatedActionCallOptions, ReadClient } from '../types.ts'
import { getApprovedProviderIds } from '../warm-storage/get-approved-provider-ids.ts'
import { getPDPProviderCall, hasActivePDPProduct, parsePDPProvider } from './get-pdp-provider.ts'
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
  export type OutputType = Page<PDPProvider>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of PDP providers.
 *
 * Pass the returned `nextCursor` back as `cursor`; treat it as opaque. Use
 * {@link paginate} to traverse every page.
 *
 * @param client - The read-only client to use to get the providers.
 * @param options - {@link getPDPProviders.OptionsType}
 * @returns The paginated providers result {@link getPDPProviders.OutputType}
 * @throws Errors {@link getPDPProviders.ErrorType}
 *
 * @example Read the first page
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
 * const page = await getPDPProviders(client, { onlyActive: true })
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getPDPProviders } from '@filoz/synapse-core/sp-registry'
 *
 * for await (const provider of paginate(({ cursor }) =>
 *   getPDPProviders(client, { onlyActive: true, cursor })
 * )) {
 *   console.log(provider.id)
 * }
 * ```
 */
export async function getPDPProviders<chain extends Chain>(
  client: ReadClient<chain>,
  options: getPDPProviders.OptionsType = {}
): Promise<getPDPProviders.OutputType> {
  const { cursor, limit } = resolvePagination(options, 50n)
  const data = await readContract(
    client,
    getPDPProvidersCall({
      chain: client.chain,
      onlyActive: options.onlyActive,
      offset: cursor,
      limit,
      contractAddress: options.contractAddress,
    })
  )
  return parsePDPProviders(data, cursor)
}

export namespace getPDPProvidersCall {
  export type OptionsType = PaginatedActionCallOptions<getPDPProviders.OptionsType, 'offset'>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProvidersByProductType'
  >
}

/**
 * Create a call to the `getProvidersByProductType` contract function,
 * specialized for PDP providers.
 *
 * This is a literal contract adapter: `offset` and `limit` are required, use
 * their contract-facing names, and are passed through unchanged. Use
 * {@link parsePDPProviders} with the same offset to convert the raw contract
 * output into a normalized page.
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
 *       offset: 0n,
 *       limit: 50n,
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
    args: [PRODUCTS.PDP, options.onlyActive ?? true, options.offset, options.limit],
  } satisfies getPDPProvidersCall.OutputType
}

/**
 * Parse raw PDP-provider contract output into a normalized page.
 *
 * Provider records are decoded into {@link PDPProvider} objects. When the
 * contract reports more results, `nextCursor` is derived from `cursor` and the
 * number of source providers returned. Pass the same offset used by
 * {@link getPDPProvidersCall}; it defaults to `0n`.
 *
 * @param data - Raw contract output {@link getPDPProviders.ContractOutputType}
 * @param cursor - Offset used for the contract read. Defaults to `0n`.
 * @returns A normalized page of PDP providers {@link getPDPProviders.OutputType}
 */
export function parsePDPProviders(data: getPDPProviders.ContractOutputType, cursor = 0n): getPDPProviders.OutputType {
  return {
    items: data.providers.map(parsePDPProvider),
    ...(data.hasMore ? { nextCursor: cursor + BigInt(data.providers.length) } : {}),
  }
}

export namespace getApprovedPDPProviders {
  export type OptionsType = Omit<getPDPProviders.OptionsType, 'onlyActive' | keyof PaginationOptions>

  export type OutputType = PDPProvider[]

  export type ErrorType =
    | asChain.ErrorType
    | MulticallErrorType
    | getApprovedProviderIds.ErrorType
    | getPDPProvidersCall.ErrorType
}

/**
 * Get FilecoinWarmStorage approved PDP providers
 *
 * @param client - The read-only client to use to get the providers.
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
export async function getApprovedPDPProviders<chain extends Chain>(
  client: ReadClient<chain>,
  options: getApprovedPDPProviders.OptionsType = {}
): Promise<getApprovedPDPProviders.OutputType> {
  const [pdpProviders, approvedProviders] = await Promise.all([
    Array.fromAsync(
      paginate(({ cursor }) =>
        getPDPProviders(client, { onlyActive: true, cursor, contractAddress: options.contractAddress })
      )
    ),
    Array.fromAsync(paginate(({ cursor }) => getApprovedProviderIds(client, { cursor }))),
  ])
  return pdpProviders.filter((provider) => approvedProviders.includes(provider.id))
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
    | getApprovedProviderIds.ErrorType
    | getPDPProvidersCall.ErrorType
}

/**
 * Get PDP providers by IDs
 *
 * @param client - The read-only client to use to get the providers.
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
 * const result = await getPDPProvidersByIds(client, {
 *   providerIds: [1n, 2n, 3n],
 * })
 *
 * console.log(result)
 * ```
 */
export async function getPDPProvidersByIds<chain extends Chain>(
  client: ReadClient<chain>,
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

  const providers: ProviderWithProduct[] = []
  for (const r of result) {
    if (r.status === 'success' && hasActivePDPProduct(r.result)) {
      providers.push(r.result)
    }
  }

  return providers.map(parsePDPProvider)
}
