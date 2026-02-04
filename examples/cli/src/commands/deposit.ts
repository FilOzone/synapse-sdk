import * as p from '@clack/prompts'
import { parseUnits, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const deposit: Command = command(
  {
    name: 'deposit',
    description: 'Deposit funds to the wallet',
    parameters: ['<amount>'],
    alias: 'd',
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Deposit funds to the wallet',
      examples: ['synapse deposit', 'synapse deposit --help'],
    },
  },
  async (argv) => {
    const { client } = privateKeyClient(argv.flags.chain)
    const synapse = new Synapse({
      client,
    })

    const spinner = p.spinner()
    spinner.start('Depositing funds...')
    try {
      const hash = await synapse.payments.depositWithPermitAndApproveOperator(
        parseUnits(argv._.amount)
      )

      spinner.message('Waiting for transaction to be mined...')

      await synapse.client.waitForTransactionReceipt({
        hash,
      })

      spinner.stop('Funds deposited')
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
