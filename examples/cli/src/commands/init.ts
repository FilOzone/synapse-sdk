import { existsSync } from 'node:fs'
import { intro, log, outro, text } from '@clack/prompts'
import { type Command, command } from 'cleye'
import { generatePrivateKey } from 'viem/accounts'

import config from '../config.ts'

export const init: Command = command(
  {
    name: 'init',
    description: 'Initialize a new service provider',
    alias: 'i',
    flags: {
      auto: {
        type: Boolean,
      },
      keystore: {
        type: String,
      },
    },
    help: {
      description: 'Initialize a new service provider',
      examples: ['synapse init', 'synapse init --auto'],
    },
  },
  async (argv) => {
    if (argv.flags.keystore) {
      if (existsSync(argv.flags.keystore)) {
        config.set('keystore', argv.flags.keystore)
        config.delete('privateKey')
        outro(`You're all set!`)
        return
      } else {
        log.error(`Keystore file not found: ${argv.flags.keystore}`)
        process.exit(1)
      }
    }

    const privateKey = config.get('privateKey')
    if (privateKey) {
      log.success(`Private key: ${privateKey}`)
      log.info(`Config file: ${config.path}`)
      outro(`You're all set!`)
      return
    }
    if (argv.flags.auto) {
      intro(`Initializing Synapse CLI...`)
      const privateKey = generatePrivateKey()
      log.success(`Private key: ${privateKey}`)
      config.set('privateKey', privateKey)
      outro(`You're all set!`)
      return
    }

    intro(`Initializing Synapse CLI...`)
    const privateKeyInput = await text({
      message: 'Enter your private key',
      validate(value) {
        if (!/^0x[a-fA-F0-9]{64}$/.test(value)) return `Invalid private key!`
      },
    })
    config.set('privateKey', privateKeyInput)
    config.delete('keystore')
    outro(`You're all set!`)
  }
)
