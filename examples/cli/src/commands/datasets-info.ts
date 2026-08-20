import * as p from '@clack/prompts'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { stringify } from 'viem'
import { publicClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const datasetsInfo: Command = command(
  {
    name: 'datasets-info',
    description: 'Show data set information',
    alias: 'di',
    parameters: ['<dataSetId>'],
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Show the Filecoin Warm Storage Service data for a data set',
      examples: [
        'synapse-cli datasets-info 123',
        'synapse-cli datasets-info 123 --chain 314',
      ],
    },
  },
  async (argv) => {
    const client = publicClient(argv.flags.chain)

    try {
      const dataSetId = BigInt(argv._.dataSetId)
      const dataSet = await getPdpDataSet(client, { dataSetId })
      if (dataSet == null) {
        throw new Error(`Data set #${dataSetId} not found`)
      }

      p.log.message(stringify(dataSet, undefined, 2))
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)
