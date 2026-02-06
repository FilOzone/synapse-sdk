import * as p from '@clack/prompts'
import { terminateServiceSync } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink, selectDataSet } from '../utils.ts'

export const datasetsTerminate: Command = command(
  {
    name: 'datasets-terminate',
    description: 'Terminate a data set',
    alias: 'dt',
    parameters: ['[dataSetId]'],
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Terminate a data set',
    },
  },
  async (argv) => {
    const { client, chain } = privateKeyClient(argv.flags.chain)

    try {
      const dataSetId = argv._.dataSetId
        ? BigInt(argv._.dataSetId)
        : await selectDataSet(client, argv.flags)
      p.log.info(`Terminating data set ${dataSetId}...`)

      const { event } = await terminateServiceSync(client, {
        dataSetId,
        onHash(hash) {
          p.log.info(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
        },
      })

      p.log.info(`Data set #${event.args.dataSetId} terminated.`)
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)
