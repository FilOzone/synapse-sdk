import * as p from '@clack/prompts'
import { readProviders } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { publicClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

interface ProviderEntry {
  providerId: bigint
  name: string
  ipniPeerID: string
}

export const getSpPeerIds: Command = command(
  {
    name: 'get-sp-peer-ids',
    description: 'Get IPNI peer IDs of all approved PDP service providers',
    flags: {
      ...globalFlags,
      json: {
        type: Boolean,
        description: 'Output as JSON',
        default: false,
      },
    },
    help: {
      description: 'Get IPNI peer IDs of all approved PDP service providers',
      examples: [
        'synapse get-sp-peer-ids',
        'synapse get-sp-peer-ids --json',
        "synapse get-sp-peer-ids --json | jq -r '.[].ipniPeerID'",
        'synapse get-sp-peer-ids --chain 314',
      ],
    },
  },
  async (argv) => {
    const client = publicClient(argv.flags.chain)
    const isJson = argv.flags.json

    const spinner = isJson ? null : p.spinner()
    spinner?.start('Fetching service providers...')

    try {
      const providers = await fetchProviderPeerIds(client)
      spinner?.stop('Service providers:')
      outputResults(providers, { isJson })
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
): Promise<ProviderEntry[]> {
  const pdpProviders = await readProviders(client)
  return pdpProviders.map<ProviderEntry>((provider) => ({
    providerId: provider.id,
    name: provider.name,
    ipniPeerID: provider.pdp.ipniPeerID,
  }))
}
function outputResults(
  providers: ProviderEntry[],
  options: { isJson: boolean }
): void {
  const { isJson } = options

  if (isJson) {
    const output = providers.map((p) => ({
      providerId: Number(p.providerId),
      name: p.name,
      ipniPeerID: p.ipniPeerID,
    }))
    console.log(JSON.stringify(output))
    return
  }

  for (const provider of providers) {
    p.log.info(
      `Provider ${provider.providerId} (${provider.name}): ${provider.ipniPeerID}`
    )
  }
}
