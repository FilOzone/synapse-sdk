import * as p from '@clack/prompts'
import type { ReadClient } from '@filoz/synapse-core'
import { paginate } from '@filoz/synapse-core'
import { toReadClient } from '@filoz/synapse-core/client'
import * as sp from '@filoz/synapse-core/sp'
import {
  getPDPProvider,
  getPDPProviders,
} from '@filoz/synapse-core/sp-registry'
import { type Command, command } from 'cleye'
import type { Chain } from 'viem'
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
    const readClient = toReadClient(client)
    try {
      const provider = argv._.providerId
        ? await getPDPProvider(readClient, {
            providerId: BigInt(argv._.providerId),
          })
        : await selectProvider(readClient, argv.flags)

      if (!provider) {
        throw new Error('Provider not found')
      }

      p.log.info(
        `Selected provider: #${provider.id} - ${provider.serviceProvider} ${provider.pdp.serviceURL}`
      )
      p.log.info(`Creating data set...`)

      const result = await sp.createDataSet(client, {
        payee: provider.payee,
        payer: client.account.address,
        serviceURL: provider.pdp.serviceURL,
        cdn: argv.flags.cdn,
      })

      p.log.info(
        `Waiting for tx ${hashLink(result.txHash, chain)} to be mined...`
      )
      const dataset = await sp.waitForCreateDataSet(result)

      p.log.info(`Data set created #${dataset.dataSetId}`)
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)

async function selectProvider(
  client: ReadClient<Chain>,
  options: { debug?: boolean }
) {
  const spinner = p.spinner()
  spinner.start(`Fetching providers...`)

  try {
    const providers = await Array.fromAsync(
      paginate(({ cursor }) => getPDPProviders(client, { cursor }))
    )
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
    if (options.debug) {
      spinner.clear()
      console.error(error)
    } else {
      spinner.error((error as Error).message)
    }
    process.exit(1)
  }
}
