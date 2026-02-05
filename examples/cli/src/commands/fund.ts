import * as p from '@clack/prompts'
import { claimTokens, formatBalance } from '@filoz/synapse-core/utils'
import { Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { waitForTransactionReceipt } from 'viem/actions'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const fund: Command = command(
  {
    name: 'fund',
    description: 'Fund the wallet',
    alias: 'f',
    flags: {
      ...globalFlags,
    },
  },
  async (argv) => {
    const { client } = privateKeyClient(argv.flags.chain)

    p.intro('Funding wallet...')
    const spinner = p.spinner()

    spinner.start('Requesting faucets...')
    try {
      const hashes = await claimTokens({ address: client.account.address })

      spinner.message(`Waiting for transactions to be mined...`)
      await waitForTransactionReceipt(client, {
        hash: hashes[0].tx_hash,
      })

      const synapse = new Synapse({
        client,
      })

      spinner.stop('Balances')
      const filBalance = await synapse.payments.walletBalance()
      const usdfcBalance = await synapse.payments.walletBalance('USDFC')
      p.log.info(`FIL balance: ${formatBalance({ value: filBalance })}`)
      p.log.info(`USDFC balance: ${formatBalance({ value: usdfcBalance })}`)
    } catch (error) {
      spinner.stop()
      console.error(error)
      p.outro('Please try again')
      return
    } finally {
      spinner.stop()
      process.exit(0)
    }
  }
)
