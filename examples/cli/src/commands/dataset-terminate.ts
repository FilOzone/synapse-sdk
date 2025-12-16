import * as p from '@clack/prompts'
import { getDataSets, terminateDataSet } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { waitForTransactionReceipt } from 'viem/actions'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const datasetTerminate: Command = command(
  {
    name: 'dataset-terminate',
    description: 'Terminate a data set',
    alias: 'dt',
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Terminate a data set',
    },
  },
  async (argv) => {
    const { client } = privateKeyClient(argv.flags.chain)

    const spinner = p.spinner()
    spinner.start(`Fetching data sets...`)
    try {
      const dataSets = await getDataSets(client, {
        address: client.account.address,
      })
      spinner.stop(`Fetching data sets complete`)

      const dataSetId = await p.select({
        message: 'Pick a data set to terminate.',
        options: dataSets
          // .filter((dataSet) => dataSet.pdpEndEpoch === 0n)
          .map((dataSet) => ({
            value: dataSet.dataSetId.toString(),
            label: `#${dataSet.dataSetId} - SP: #${dataSet.providerId} ${dataSet.pdp.serviceURL}`,
          })),
      })
      if (p.isCancel(dataSetId)) {
        p.cancel('Operation cancelled.')
        process.exit(0)
      }

      spinner.start(`Terminating data set ${dataSetId}...`)
      // const synapse = await Synapse.create({
      //   privateKey: privateKey as Hex,
      //   rpcURL: RPC_URLS.calibration.http,
      // })

      // const tx = await synapse.storage.terminateDataSet(Number(dataSetId))

      const tx = await terminateDataSet(client, {
        dataSetId: BigInt(dataSetId),
      })

      spinner.message(`Waiting for transaction to be mined...`)
      await waitForTransactionReceipt(client, {
        hash: tx,
      })

      spinner.stop(`Data set terminated`)
    } catch (error) {
      spinner.stop()
      console.error(error)
      p.outro('Please try again')
      return
    }
  }
)
