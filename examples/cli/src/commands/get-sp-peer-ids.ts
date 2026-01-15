import * as p from '@clack/prompts'
import { getChain } from '@filoz/synapse-core/chains'
import { type Command, command } from 'cleye'
import { base58btc } from 'multiformats/bases/base58'
import { fromHex, type Hex } from 'viem'
import { readContract } from 'viem/actions'
import { publicClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

interface ProviderPeerId {
  providerId: bigint
  name: string
  peerId: string
}

export const getSpPeerIds: Command = command(
  {
    name: 'get-sp-peer-ids',
    description: 'Get IPNI peer IDs of all active PDP service providers',
    flags: {
      ...globalFlags,
      json: {
        type: Boolean,
        description: 'Output as JSON',
        default: false,
      },
      'peer-ids-only': {
        type: Boolean,
        description: 'Output only peer IDs, one per line',
        default: false,
      },
    },
    help: {
      description: 'Get IPNI peer IDs of all active PDP service providers',
      examples: [
        'synapse get-sp-peer-ids',
        'synapse get-sp-peer-ids --json',
        'synapse get-sp-peer-ids --peer-ids-only',
        'synapse get-sp-peer-ids --json --peer-ids-only',
        'synapse get-sp-peer-ids --chain 314',
      ],
    },
  },
  async (argv) => {
    const client = publicClient(argv.flags.chain)
    const isJson = argv.flags.json
    const peerIdsOnly = argv.flags['peer-ids-only']

    const spinner = isJson ? null : p.spinner()
    spinner?.start('Fetching service providers...')

    try {
      const providers = await fetchProviderPeerIds(client)
      spinner?.stop('Service providers:')
      outputResults(providers, { isJson, peerIdsOnly })
    } catch (error) {
      spinner?.stop()
      console.error(error)
      p.outro('Failed to fetch service providers')
      process.exit(1)
    }
  }
)

async function fetchProviderPeerIds(
  client: ReturnType<typeof publicClient>
): Promise<ProviderPeerId[]> {
  const chain = getChain(client.chain.id)
  const providers: ProviderPeerId[] = []
  const limit = 100n

  for (let offset = 0n; ; offset += limit) {
    const result = await readContract(client, {
      address: chain.contracts.serviceProviderRegistry.address,
      abi: chain.contracts.serviceProviderRegistry.abi,
      functionName: 'getProvidersByProductType',
      args: [0, true, offset, limit], // productType (PDP=0), onlyActive, offset, limit
    })

    for (const provider of result.providers) {
      const peerIdIndex =
        provider.product.capabilityKeys.indexOf('IPNIPeerID')
      if (peerIdIndex === -1) continue

      const peerIdHex = provider.productCapabilityValues[peerIdIndex] as Hex
      providers.push({
        providerId: provider.providerId,
        name: provider.providerInfo.name,
        peerId: base58btc.encode(fromHex(peerIdHex, 'bytes')),
      })
    }

    if (result.providers.length < Number(limit)) break
  }

  return providers
}

function outputResults(
  providers: ProviderPeerId[],
  options: { isJson: boolean; peerIdsOnly: boolean }
): void {
  const { isJson, peerIdsOnly } = options

  if (isJson) {
    const output = peerIdsOnly
      ? providers.map((p) => p.peerId)
      : providers.map((p) => ({
          providerId: Number(p.providerId),
          name: p.name,
          peerId: p.peerId,
        }))
    console.log(JSON.stringify(output))
    return
  }

  for (const provider of providers) {
    if (peerIdsOnly) {
      console.log(provider.peerId)
    } else {
      p.log.info(
        `Provider ${provider.providerId} (${provider.name}): ${provider.peerId}`
      )
    }
  }
}
