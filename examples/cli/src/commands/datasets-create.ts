import * as p from '@clack/prompts'
import * as sp from '@filoz/synapse-core/sp'
import {
  createDataSet,
  getProvider,
  readProviders,
} from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import type { Account, Chain, Client, Transport } from 'viem'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink } from '../utils.ts'

export const datasetsCreate: Command = command(
  {
    name: 'datasets-create',
    description: 'Create a data set',
    alias: 'dc',
    parameters: ['[providerId]'],
    flags: {
      ...globalFlags,
      cdn: {
        type: Boolean,
        description: 'Enable CDN',
        default: false,
      },
    },
    help: {
      description: 'Create a data set',
    },
  },
  async (argv) => {
    const { client, chain } = privateKeyClient(argv.flags.chain)

    const spinner = p.spinner()
    try {
      const provider = argv._.providerId
        ? await getProvider(client, { providerId: BigInt(argv._.providerId) })
        : await selectProvider(client, argv.flags)

      p.log.info(
        `Selected provider: #${provider.id} - ${provider.serviceProvider} ${provider.pdp.serviceURL}`
      )
      spinner.start(`Creating data set...`)

      const result = await createDataSet(client, {
        payee: provider.payee,
        payer: client.account.address,
        endpoint: provider.pdp.serviceURL,
        cdn: argv.flags.cdn,
      })

      spinner.message(
        `Waiting for tx ${hashLink(result.txHash, chain)} to be mined...`
      )
      const dataset = await sp.waitForDataSetCreationStatus(result)

      spinner.stop(`Data set created #${dataset.dataSetId}`)
    } catch (error) {
      spinner.stop('Failed to create data set', 1)
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
      process.exit(1)
    }
  }
)

async function selectProvider(
  client: Client<Transport, Chain, Account>,
  options: { debug?: boolean }
) {
  const spinner = p.spinner()
  spinner.start(`Fetching providers...`)

  try {
    const providers = await readProviders(client)
    spinner.stop(`Fetching providers complete`)

    const provider = await p.select({
      message: 'Pick a provider to create a data set.',
      options: providers.map((provider) => ({
        value: provider,
        label: `#${provider.id} - ${provider.serviceProvider} ${provider.pdp.serviceURL}`,
      })),
    })
    if (p.isCancel(provider)) {
      p.cancel('Operation cancelled.')
      process.exit(1)
    }
    return provider
  } catch (error) {
    spinner.stop('Failed to select data set', 1)
    if (options.debug) {
      console.error(error)
    } else {
      p.log.error((error as Error).message)
    }
    process.exit(1)
  }
}
