import * as p from '@clack/prompts'
import { calibration } from '@filoz/synapse-core/chains'
import { getDataSets, terminateDataSet } from '@filoz/synapse-core/warm-storage'
import { RPC_URLS, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import config from '../config.ts'

const publicClient = createPublicClient({
  chain: calibration,
  transport: http(),
})

export const datasetTerminate: Command = command(
  {
    name: 'dataset-terminate',
    description: 'Terminate a data set',
    alias: 'dt',
    help: {
      description: 'Terminate a data set',
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
    const client = createWalletClient({
      account,
      chain: calibration,
      transport: http(),
    })

    const spinner = p.spinner()
    spinner.start(`Fetching data sets...`)
    try {
      const dataSets = await getDataSets(publicClient, {
        address: account.address,
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
      await waitForTransactionReceipt(publicClient, {
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
