import * as p from '@clack/prompts'
import { calibration } from '@filoz/synapse-core/chains'
import { depositAndApprove } from '@filoz/synapse-core/pay'
import { type Command, command } from 'cleye'
import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import config from '../config.ts'

const publicClient = createPublicClient({
  chain: calibration,
  transport: http(),
})

export const deposit: Command = command(
  {
    name: 'deposit',
    description: 'Deposit funds to the wallet',
    alias: 'd',
    help: {
      description: 'Deposit funds to the wallet',
      examples: ['synapse deposit', 'synapse deposit --help'],
    },
  },
  async (_argv) => {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      p.log.error('Private key not found')
      p.outro('Please run `synapse init` to initialize the CLI')
      return
    }
    const client = createWalletClient({
      account: privateKeyToAccount(privateKey as Hex),
      chain: calibration,
      transport: http(),
    })

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

      await waitForTransactionReceipt(publicClient, {
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
