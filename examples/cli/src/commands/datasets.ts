import * as p from '@clack/prompts'
import { paginate } from '@filoz/synapse-core'
import { getPdpDataSets } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { getBlockNumber } from 'viem/actions'
import { privateKeyClient } from '../client.ts'
import { Address, globalFlags } from '../flags.ts'

export const datasets: Command = command(
  {
    name: 'datasets',
    description: 'List all data sets',
    alias: 'ds',
    flags: {
      ...globalFlags,
      address: {
        type: Address,
        description: 'The address to list data sets for',
        default: undefined,
      },
    },
    help: {
      description: 'List all data sets',
      examples: ['synapse datasets', 'synapse datasets --help'],
    },
  },
  async (argv) => {
    const { client } = privateKeyClient(argv.flags.chain)

    const blockNumber = await getBlockNumber(client)
    const address = argv.flags.address ?? client.account.address

    p.log.info('Listing data sets...')
    try {
      for await (const item of paginate(({ cursor }) =>
        getPdpDataSets(client, { address, cursor })
      )) {
        p.log.step(
          `#${item.dataSetId} ${new URL(item.provider.pdp.serviceURL).hostname} #${item.providerId} ${item.pdpEndEpoch > 0n ? `Terminating at epoch ${item.pdpEndEpoch}` : ''}${item.cdn ? ' CDN' : ''}`,
          { spacing: 0 }
        )
      }
      p.log.warn(`Block number: ${blockNumber}`)
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)
