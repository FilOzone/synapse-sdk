import * as p from '@clack/prompts'
import { getPdpDataSets } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { getBlockNumber } from 'viem/actions'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const datasets: Command = command(
  {
    name: 'datasets',
    description: 'List all data sets',
    alias: 'ds',
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'List all data sets',
      examples: ['synapse datasets', 'synapse datasets --help'],
    },
  },
  async (argv) => {
    const { client } = privateKeyClient(argv.flags.chain)

    const spinner = p.spinner()

    const blockNumber = await getBlockNumber(client)

    spinner.start('Listing data sets...')
    try {
      const dataSets = await getPdpDataSets(client, {
        client: client.account.address,
      })
      spinner.stop('Data sets:')
      dataSets.forEach(async (dataSet) => {
        p.log.info(
          `#${dataSet.dataSetId} ${dataSet.cdn ? 'CDN' : ''} ${dataSet.provider.pdp.serviceURL} ${dataSet.pdpEndEpoch > 0n ? `Terminating at epoch ${dataSet.pdpEndEpoch}` : ''} ${dataSet.live ? 'Live' : ''} ${dataSet.managed ? 'Managed' : ''}`
        )
      })
      p.log.warn(`Block number: ${blockNumber}`)
    } catch (error) {
      if (argv.flags.debug) {
        spinner.clear()
        console.error(error)
      } else {
        spinner.error((error as Error).message)
      }
    }
  }
)
