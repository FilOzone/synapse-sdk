import * as p from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
import {
  extractPDPPaymentTerminatedEvent,
  getPdpDataSet,
  terminateServiceSync,
} from '@filoz/synapse-core/warm-storage'
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
      onChain: {
        type: Boolean,
        description: 'Terminate the data set on chain',
        default: false,
      },
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

      let endEpoch: bigint

      if (argv.flags.onChain) {
        const { receipt } = await terminateServiceSync(client, {
          dataSetId,
          onHash(hash) {
            p.log.info(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
          },
        })
        endEpoch = extractPDPPaymentTerminatedEvent(receipt.logs).args.endEpoch
      } else {
        const dataset = await getPdpDataSet(client, { dataSetId })
        if (!dataset) {
          throw new Error('Data set not found')
        }
        const { statusUrl } = await SP.terminateService(client, {
          dataSetId,
          serviceURL: dataset.provider.pdp.serviceURL,
        })
        const status = await SP.waitForTerminateService({
          statusUrl,
          onHash(hash) {
            p.log.info(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
          },
        })
        endEpoch = status.serviceTerminationEpoch
      }

      p.log.info(`Data set #${dataSetId} terminated at epoch ${endEpoch}.`)
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)
