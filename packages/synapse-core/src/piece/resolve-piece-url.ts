import { request } from 'iso-web/http'
import pLocate from 'p-locate'
import pSome from 'p-some'
import type { Address, Chain, Client, Transport } from 'viem'
import { asChain } from '../chains.ts'
import { findPiece } from '../sp/sp.ts'
import type { PDPProvider } from '../sp-registry/types.ts'
import { createPieceUrlPDP } from '../utils/piece-url.ts'
import { getPdpDataSets } from '../warm-storage/get-pdp-data-sets.ts'
import type { PieceCID } from './piece.ts'

export namespace resolvePieceUrl {
  export type ResolverFnType = (options: ResolverFnOptionsType) => Promise<string>
  export type OptionsType = {
    /** The client to use to resolve the piece URL. */
    client: Client<Transport, Chain>
    /** The address of the user. */
    address: Address
    /** The piece CID to resolve. */
    pieceCid: PieceCID
    /** The signal to abort the request. */
    signal?: AbortSignal
    /** The resolvers to use to resolve the piece URL. Defaults to {@link defaultResolvers}. */
    resolvers?: ResolverFnType[]
  }
  export type ResolverFnOptionsType = Omit<OptionsType, 'resolvers'>

  export type OutputType = string
  export type ErrorType = AggregateError
}

/**
 * The default resolvers to use when resolving the piece URL
 */
export const defaultResolvers: resolvePieceUrl.ResolverFnType[] = [filbeamResolver, chainResolver]

/**
 * Resolve the piece URL from the available resolvers
 *
 * @param options - {@link resolvePieceUrl.OptionsType}
 * @returns The piece URL or throws an error if no URL is found
 * @throws Errors {@link AggregateError} If no URL is found
 *
 * @example
 * ```ts
 * import { resolvePieceUrl } from '@filoz/synapse-core/piece'
 * import { getApprovedPDPProviders } from '@filoz/synapse-core/sp-registry'
 * const providers = await getApprovedPDPProviders(client)
 *
 * const pieceUrl = await resolvePieceUrl({
 *   client: client,
 *   address: '0x1234567890123456789012345678901234567890',
 *   pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
 *   resolvers: [filbeamResolver, chainResolver, providersResolver(providers)],
 * })
 * console.log(pieceUrl) // https://0x1234567890123456789012345678901234567890.mainnet.filbeam.io/bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
 */
export async function resolvePieceUrl(options: resolvePieceUrl.OptionsType): Promise<resolvePieceUrl.OutputType> {
  const { address, client, pieceCid, signal, resolvers = defaultResolvers } = options
  asChain(client.chain)

  const controller = new AbortController()
  const _signal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal

  const result = await pSome(
    resolvers.map((resolver) => resolver({ address, client, pieceCid, signal: _signal })),
    { count: 1 }
  )
  controller.abort()
  return result[0]
}

/**
 * Resolve the piece URL from the FilBeam CDN
 *
 * @param options - {@link resolvePieceUrl.ResolverFnOptionsType}
 * @returns The piece URL
 * @throws Errors {@link Error} If FilBeam is not supported on this chain
 *
 * @example
 * ```ts
 * import { filbeamResolver } from '@filoz/synapse-core/piece'
 * const pieceUrl = await filbeamResolver({
 *   address: '0x1234567890123456789012345678901234567890',
 *   pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
 *   client: client,
 * })
 */
export async function filbeamResolver(options: resolvePieceUrl.ResolverFnOptionsType): Promise<string> {
  const { address, pieceCid, signal } = options
  const chain = asChain(options.client.chain)
  if (chain.filbeam == null) {
    throw new Error('FilBeam not supported on this chain')
  }
  const url = `https://${address}.${chain.filbeam.retrievalDomain}/${pieceCid.toString()}`
  const result = await request.head(url, {
    signal,
  })
  if (result.error) {
    throw result.error
  }
  return url
}

/**
 * Resolve the piece URL from the chain
 *
 * @param options - {@link resolvePieceUrl.ResolverFnOptionsType}
 * @returns The piece URL
 * @throws Errors {@link Error} If no provider found
 *
 * @example
 * ```ts
 * import { chainResolver } from '@filoz/synapse-core/piece'
 * const pieceUrl = await chainResolver({
 *   address: '0x1234567890123456789012345678901234567890',
 *   pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
 *   client: client,
 * })
 */
export async function chainResolver(options: resolvePieceUrl.ResolverFnOptionsType): Promise<string> {
  const { address, client, pieceCid, signal } = options
  const dataSets = await getPdpDataSets(client, {
    address,
  })

  const providersById = dataSets.reduce((acc, dataSet) => {
    if (dataSet.live && dataSet.managed && dataSet.pdpEndEpoch === 0n) {
      acc.set(dataSet.providerId, dataSet.provider)
    }
    return acc
  }, new Map<bigint, (typeof dataSets)[number]['provider']>())
  const providers = [...providersById.values()]

  const result = await pingProviders(providers, pieceCid, signal)
  if (result == null) {
    throw new Error('No provider found')
  }
  return createPieceUrlPDP({
    cid: pieceCid.toString(),
    serviceURL: result.pdp.serviceURL,
  })
}

/**
 * Resolve the piece URL from the providers
 *
 * @param providers - {@link PDPProvider[]}
 * @returns A resolver function that resolves the piece URL from the providers
 * @throws Errors {@link Error} If no provider found
 *
 * @example
 * ```ts
 * import { providersResolver } from '@filoz/synapse-core/piece'
 * const resolver = providersResolver(providers)
 * const pieceUrl = await resolver({
 *   pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
 * })
 */
export function providersResolver(providers: PDPProvider[]): resolvePieceUrl.ResolverFnType {
  return async (options: resolvePieceUrl.ResolverFnOptionsType) => {
    const { pieceCid, signal } = options
    const result = await pingProviders(providers, pieceCid, signal)
    if (result == null) {
      throw new Error('No provider found')
    }

    return createPieceUrlPDP({
      cid: pieceCid.toString(),
      serviceURL: result.pdp.serviceURL,
    })
  }
}

/**
 * Ping the providers to find the piece URL
 * @param providers - {@link PDPProvider[]}
 * @param pieceCid - {@link PieceCID}
 * @param signal - {@link AbortSignal}
 * @returns The piece URL
 */
export async function pingProviders(providers: PDPProvider[], pieceCid: PieceCID, signal?: AbortSignal) {
  const controller = new AbortController()
  const _signal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal

  const result = await pLocate(
    providers.map((p) =>
      findPiece({
        serviceURL: p.pdp.serviceURL,
        pieceCid,
        signal: _signal,
      }).then(
        () => p,
        () => null
      )
    ),
    (p) => {
      if (p !== null) {
        controller.abort()
        return true
      }
      return false
    },
    { concurrency: 5 }
  )
  return result
}
