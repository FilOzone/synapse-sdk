import * as p from '@clack/prompts'
import { calibration } from '@filoz/synapse-core/chains'
import { getDataSets } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { createPublicClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from '../config.ts'

const publicClient = createPublicClient({
  chain: calibration,
  transport: http(),
})

export const datasets: Command = command(
  {
    name: 'datasets',
    description: 'List all data sets',
    alias: 'ds',
    help: {
      description: 'List all data sets',
      examples: ['synapse datasets', 'synapse datasets --help'],
    },
  },
  async (argv) => {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      p.log.error('Private key not found')
      p.outro('Please run `synapse init` to initialize the CLI')
      return
    }

    const account = privateKeyToAccount(privateKey as Hex)
    const spinner = p.spinner()

    spinner.start('Listing data sets...')
    try {
      const dataSets = await getDataSets(publicClient, {
        address: account.address,
      })
      spinner.stop('Data sets:')
      dataSets.forEach(async (dataSet) => {
        p.log.info(
          `#${dataSet.dataSetId} ${dataSet.pdp.serviceURL} ${dataSet.pdpEndEpoch > 0n ? `Terminating at epoch ${dataSet.pdpEndEpoch}` : ''}`
        )
      })
    } catch (error) {
      spinner.stop()
      console.error(error)
      p.outro('Failed to list data sets')
      return
    }
  }
)
