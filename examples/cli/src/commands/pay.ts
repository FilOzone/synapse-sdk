import * as p from '@clack/prompts'
import { formatBalance } from '@filoz/synapse-core/utils'
import { RPC_URLS, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import type { Hex } from 'viem'
import config from '../config.ts'

export const pay: Command = command(
  {
    name: 'pay',
    description: 'Check wallet balances',
    alias: 'p',
    help: {
      description: 'Check wallet balances',
      examples: ['synapse pay', 'synapse pay --help'],
    },
  },
  async (argv) => {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      p.log.error('Private key not found')
      p.outro('Please run `synapse init` to initialize the CLI')
      return
    }

    const spinner = p.spinner()

    spinner.start('Checking wallet balance...')
    try {
      const synapse = await Synapse.create({
        privateKey: privateKey as Hex,
        rpcURL: RPC_URLS.calibration.http, // Use calibration testnet for testing
      })

      const filBalance = await synapse.payments.walletBalance()
      const usdfcBalance = await synapse.payments.walletBalance('USDFC')
      const paymentsBalance = await synapse.payments.accountInfo()

      spinner.stop('Balances')
      p.log.info(`FIL balance: ${formatBalance({ value: filBalance })}`)
      p.log.info(`USDFC balance: ${formatBalance({ value: usdfcBalance })}`)
      p.log.info(`Available funds: ${formatBalance({ value: paymentsBalance.availableFunds })}`)
      p.log.info(`Lockup current: ${formatBalance({ value: paymentsBalance.lockupCurrent })}`)
      p.log.info(`Lockup rate: ${formatBalance({ value: paymentsBalance.lockupRate })}`)
      p.log.info(`Lockup last settled at: ${formatBalance({ value: paymentsBalance.lockupLastSettledAt })}`)
      p.log.info(`Funds: ${formatBalance({ value: paymentsBalance.funds })}`)
      p.log.info(`Address: ${await synapse.getSigner().getAddress()}`)
    } catch (error) {
      spinner.stop()
      p.log.error((error as Error).message)
      p.outro('Please try again')
      return
    }
  }
)
