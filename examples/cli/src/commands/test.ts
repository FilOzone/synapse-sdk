import * as p from '@clack/prompts'
import { asChain, type Chain as SynapseChain } from '@filoz/synapse-core/chains'
import { type PieceCID, parse } from '@filoz/synapse-core/piece'
import { findPiece } from '@filoz/synapse-core/sp'
import {
  getApprovedPDPProviders,
  type PDPProvider,
} from '@filoz/synapse-core/sp-registry'
import { createPieceUrlPDP } from '@filoz/synapse-core/utils'
import { getPdpDataSets } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { request } from 'iso-web/http'
import pAny from 'p-any'
import pLocate from 'p-locate'
import pRace from 'p-race'
import pSome from 'p-some'
import type { Address, Chain, Client, Transport } from 'viem'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const test: Command = command(
  {
    name: 'test',
    description: 'Test the Synapse SDK',
    alias: 't',
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Test the Synapse SDK',
      examples: ['synapse test', 'synapse test --help'],
    },
  },
  async (argv) => {
    const { client } = privateKeyClient(argv.flags.chain)

    p.log.info('Listing data sets...')
    try {
      const cid = parse(
        'bafkzcibdrqaqipehbnbgxfqwavfhpb42jmf5ds6cou6nfw4awiobgmtztw5uuuy6'
        // 'bafkzcibdzybqkar3gbv6vhl6vmoczqs64afjrhqzpelb7xjq2kaindbzt3z43mi3'
      )
      console.time('resolve')
      const providers = await getApprovedPDPProviders(client)
      console.timeLog('resolve', 'getApprovedPDPProviders', providers.length)
      const result = await resolve({
        address: client.account.address,
        client,
        pieceCid: cid,
        resolvers: [
          filbeamResolver,
          chainResolver,
          providersResolver(providers),
        ],
      })
      console.timeLog('resolve', 'DONE', result)
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)

/**
 * Generic result with error
 */
export type MaybeResult<ResultType = unknown, ErrorType = Error> =
  | {
      error: ErrorType
      result?: undefined
    }
  | {
      result: ResultType
      error?: undefined
    }

interface ResolverOptions {
  address: Address
  client: Client<Transport, SynapseChain>
  pieceCid: PieceCID
  signal?: AbortSignal
}

type Resolver = (options: ResolverOptions) => Promise<string>

interface ResolveOptions {
  client: Client<Transport, Chain>
  address: Address
  pieceCid: PieceCID
  signal?: AbortSignal
  resolvers: Resolver[]
}

async function resolve(options: ResolveOptions): Promise<string> {
  const { address, client, pieceCid, signal, resolvers } = options
  asChain(client.chain)
  const _client = client as Client<Transport, SynapseChain>

  const controller = new AbortController()
  const _signal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal

  const result = await pSome(
    resolvers.map((resolver) =>
      resolver({ address, client: _client, pieceCid, signal: _signal })
    ),
    { count: 1 }
  )
  controller.abort()
  return result[0]
}

async function filbeamResolver(options: ResolverOptions): Promise<string> {
  const { address, client, pieceCid, signal } = options
  if (client.chain.filbeam == null) {
    throw new Error('FilBeam not supported on this chain')
  }
  console.time('beam')
  const url = `https://${address}.${client.chain.filbeam.retrievalDomain}/${pieceCid.toString()}`
  const result = await request.head(url, {
    signal,
  })
  console.timeLog('beam', 'DONE')
  console.timeLog('resolve', 'filbeamResolver')
  if (result.error) {
    throw result.error
  }
  return url
}

async function chainResolver(options: ResolverOptions): Promise<string> {
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
  console.timeLog('resolve', 'chainResolver', result?.pdp.serviceURL)
  return createPieceUrlPDP({
    cid: pieceCid.toString(),
    serviceURL: result.pdp.serviceURL,
  })
}

function providersResolver(providers: PDPProvider[]) {
  return async (options: ResolverOptions) => {
    const { pieceCid, signal } = options
    console.time('providers')
    const result = await pingProviders(providers, pieceCid, signal)
    if (result == null) {
      throw new Error('No provider found')
    }
    console.timeLog('providers', 'DONE')
    console.timeLog('resolve', 'providersResolver', result.pdp.serviceURL)
    return result.pdp.serviceURL
  }
}

async function pingProviders(
  providers: PDPProvider[],
  pieceCid: PieceCID,
  signal?: AbortSignal
) {
  const controller = new AbortController()
  const _signal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal

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
