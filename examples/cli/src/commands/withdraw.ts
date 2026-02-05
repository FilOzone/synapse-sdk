import * as p from '@clack/prompts'
import { parseUnits, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink } from '../utils.ts'

export const withdraw: Command = command(
  {
    name: 'withdraw',
    description: 'Withdraw funds from the wallet',
    parameters: ['<amount>'],
    alias: 'w',
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Withdraw funds from the wallet',
      examples: ['synapse withdraw', 'synapse withdraw --help'],
    },
  },
  async (argv) => {
    const { client, chain } = privateKeyClient(argv.flags.chain)
    const synapse = new Synapse({
      client,
    })

    const spinner = p.spinner()
    spinner.start('Withdrawing funds...')
    try {
      const hash = await synapse.payments.withdraw(parseUnits(argv._.amount))

      spinner.message(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)

      await synapse.client.waitForTransactionReceipt({
        hash,
      })

      spinner.stop('Funds withdrawn')
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
