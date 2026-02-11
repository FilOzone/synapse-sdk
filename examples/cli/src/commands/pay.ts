import * as p from '@clack/prompts'
import { formatBalance } from '@filoz/synapse-core/utils'
import { Synapse, TOKENS } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const pay: Command = command(
  {
    name: 'pay',
    description: 'Check wallet balances',
    alias: 'p',
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Check wallet balances',
      examples: ['synapse pay', 'synapse pay --help'],
    },
  },
  async (argv) => {
    const { client } = privateKeyClient(argv.flags.chain)

    const spinner = p.spinner()

    spinner.start('Checking wallet balance...')
    try {
      const synapse = new Synapse({
        client,
      })

      const filBalance = await synapse.payments.walletBalance()
      const usdfcBalance = await synapse.payments.walletBalance({
        token: TOKENS.USDFC,
      })
      const paymentsBalance = await synapse.payments.accountInfo()

      spinner.stop('Balances')
      p.log.info(`FIL balance: ${formatBalance({ value: filBalance })}`)
      p.log.info(`USDFC balance: ${formatBalance({ value: usdfcBalance })}`)
      p.log.info(
        `Available funds: ${formatBalance({ value: paymentsBalance.availableFunds })}`
      )
      p.log.info(
        `Lockup current: ${formatBalance({ value: paymentsBalance.lockupCurrent })}`
      )
      p.log.info(
        `Lockup rate: ${formatBalance({ value: paymentsBalance.lockupRate })}`
      )
      p.log.info(
        `Lockup last settled at: ${formatBalance({ value: paymentsBalance.lockupLastSettledAt })}`
      )
      p.log.info(`Funds: ${formatBalance({ value: paymentsBalance.funds })}`)
      p.log.info(`Address: ${client.account.address}`)
    } catch (error) {
      spinner.stop()
      p.log.error((error as Error).message)
      p.outro('Please try again')
      return
    }
  }
)
