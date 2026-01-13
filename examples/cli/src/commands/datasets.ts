import * as p from '@clack/prompts'
import { getDataSets } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
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

    spinner.start('Listing data sets...')
    try {
      const dataSets = await getDataSets(client, {
        address: client.account.address,
      })
      spinner.stop('Data sets:')
      dataSets.forEach(async (dataSet) => {
        p.log.info(
          `#${dataSet.dataSetId} ${dataSet.cdn ? 'CDN' : ''} ${dataSet.pdp.serviceURL} ${dataSet.pdpEndEpoch > 0n ? `Terminating at epoch ${dataSet.pdpEndEpoch}` : ''}`
        )
        console.log(dataSet)
      })
    } catch (error) {
      spinner.stop()
      console.error(error)
      p.outro('Failed to list data sets')
      return
    }
  }
)
