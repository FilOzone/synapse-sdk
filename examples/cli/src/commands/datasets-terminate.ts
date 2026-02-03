import * as p from '@clack/prompts'
import { getDataSets, terminateDataSet } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import type { Account, Chain, Client, Transport } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink } from '../utils.ts'

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

    const spinner = p.spinner()
    try {
      const dataSetId = argv._.dataSetId
        ? BigInt(argv._.dataSetId)
        : await selectDataSet(client, argv.flags)
      spinner.start(`Terminating data set ${dataSetId}...`)

      const tx = await terminateDataSet(client, {
        dataSetId,
      })

      spinner.message(`Waiting for tx ${hashLink(tx, chain)} to be mined...`)
      await waitForTransactionReceipt(client, {
        hash: tx,
      })

      spinner.stop(`Data set terminated`)
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

async function selectDataSet(
  client: Client<Transport, Chain, Account>,
  options: { debug?: boolean }
) {
  const spinner = p.spinner()
  spinner.start(`Fetching data sets...`)

  try {
    const dataSets = await getDataSets(client, {
      address: client.account.address,
    })
    spinner.stop(`Fetching data sets complete`)

    const dataSetId = await p.select({
      message: 'Pick a data set to terminate.',
      options: dataSets.map((dataSet) => ({
        value: dataSet.dataSetId,
        label: `#${dataSet.dataSetId} - SP: #${dataSet.providerId} ${dataSet.pdp.serviceURL} ${dataSet.pdpEndEpoch > 0n ? `Terminating at epoch ${dataSet.pdpEndEpoch}` : ''}`,
      })),
    })
    if (p.isCancel(dataSetId)) {
      p.cancel('Operation cancelled.')
      process.exit(1)
    }

    return dataSetId
  } catch (error) {
    spinner.error('Failed to select data set')
    if (options.debug) {
      console.error(error)
    } else {
      p.log.error((error as Error).message)
    }
    process.exit(1)
  }
}
