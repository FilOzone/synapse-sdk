import * as p from '@clack/prompts'
import { depositAndApprove } from '@filoz/synapse-core/pay'
import { type Command, command } from 'cleye'
import { parseEther } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const deposit: Command = command(
  {
    name: 'deposit',
    description: 'Deposit funds to the wallet',
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

    const spinner = p.spinner()
    const value = await p.text({
      message: 'Enter the amount to deposit',
    })

    if (p.isCancel(value)) {
      p.cancel('Operation cancelled.')
      process.exit(0)
    }

    spinner.start('Depositing funds...')
    try {
      const hash = await depositAndApprove(client, {
        amount: parseEther(value),
      })

      spinner.message('Waiting for transaction to be mined...')

      await waitForTransactionReceipt(client, {
        hash,
      })

      spinner.stop('Funds deposited')
    } catch (error) {
      spinner.stop()
      console.error(error)
      p.outro('Failed to deposit funds')
      return
    }
  }
)
