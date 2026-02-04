import * as p from '@clack/prompts'
import { getPDPProviders } from '@filoz/synapse-core/sp-registry'
import { type Command, command } from 'cleye'
import { publicClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

interface ProviderEntry {
  providerId: bigint
  name: string
  ipniPeerId?: string
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
        "synapse get-sp-peer-ids --json | jq -r '.[] | select(.ipniPeerId != null) | .ipniPeerId'",
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

async function fetchProviderPeerIds(client: ReturnType<typeof publicClient>) {
  const result = await getPDPProviders(client)
  return result.providers.map((provider) => ({
    providerId: provider.id,
    name: provider.name,
    ipniPeerId: provider.pdp.ipniPeerId,
  }))
}
function outputResults(
  providers: ProviderEntry[],
  options: { isJson: boolean }
): void {
  const { isJson } = options

  if (isJson) {
    const output = providers.map((provider) => ({
      // While converting BigInt to Number can lose precision, it's unlikely
      // that we will have more than 2^53-1 providers. We can afford to represent
      // providerId value as a number in the JSON output.
      providerId: Number(provider.providerId),
      name: provider.name,
      ipniPeerId: provider.ipniPeerId,
    }))
    console.log(JSON.stringify(output))
    return
  }

  for (const provider of providers) {
    p.log.info(
      `Provider ${provider.providerId} (${provider.name}): ${provider.ipniPeerId ?? '<not provided>'}`
    )
  }
}
