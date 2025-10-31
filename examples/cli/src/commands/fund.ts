import * as p from '@clack/prompts'
import { calibration } from '@filoz/synapse-core/chains'
import { claimTokens, formatBalance } from '@filoz/synapse-core/utils'
import { RPC_URLS, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { createPublicClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import config from '../config.ts'

const publicClient = createPublicClient({
  chain: calibration,
  transport: http(),
})

export const fund: Command = command(
  {
    name: 'fund',
    description: 'Fund the wallet',
    alias: 'f',
  },
  async (_argv) => {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      p.log.error('Private key not found')
      p.outro('Please run `synapse init` to initialize the CLI')
      return
    }

    p.intro('Funding wallet...')
    const spinner = p.spinner()
    const account = privateKeyToAccount(privateKey as Hex)

    spinner.start('Requesting faucets...')
    try {
      const hashes = await claimTokens({ address: account.address })

      spinner.message(`Waiting for transactions to be mined...`)
      await waitForTransactionReceipt(publicClient, {
        hash: hashes[0].tx_hash,
      })

      const synapse = await Synapse.create({
        privateKey: privateKey as Hex,
        rpcURL: RPC_URLS.calibration.http, // Use calibration testnet for testing
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
