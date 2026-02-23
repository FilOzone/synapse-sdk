import * as p from '@clack/prompts'
import * as SessionKey from '@filoz/synapse-core/session-key'
import { createDataSet, waitForCreateDataSet } from '@filoz/synapse-core/sp'
import { type Command, command } from 'cleye'
import type { Hex } from 'viem'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink } from '../utils.ts'

export const sessionKeys: Command = command(
  {
    name: 'session-keys',
    description: 'Manage session keys',
    alias: 'sk',
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Manage session keys',
    },
  },
  async (argv) => {
    const { client, chain } = privateKeyClient(argv.flags.chain)

    console.log('🚀 ~ client.account.address:', client.account.address)

    const sessionKey = SessionKey.fromSecp256k1({
      privateKey:
        '0xaa14e25eaea762df1533e72394b85e56dd0c7aa61cf6df3b1f13a842ca0361e5' as Hex,
      root: client.account,
      chain,
    })

    sessionKey.on('expirationsUpdated', (e) => {
      console.log('🚀 ~ expirations:', e.detail)
    })
    sessionKey.on('connected', (e) => {
      console.log('🚀 ~ connected:', e.detail)
    })
    sessionKey.on('disconnected', () => {
      console.log('🚀 ~ disconnected')
    })
    sessionKey.on('error', (e) => {
      console.log('🚀 ~ error:', e.detail)
    })

    const { event: loginEvent } = await SessionKey.loginSync(client, {
      address: sessionKey.address,
      onHash(hash) {
        p.log.info(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
      },
    })
    console.log('🚀 ~ event:', loginEvent.args)

    await sessionKey.connect()

    if (sessionKey.hasPermission('CreateDataSet')) {
      const result = await createDataSet(sessionKey.client, {
        payee: '0xa3971A7234a3379A1813d9867B531e7EeB20ae07',
        payer: sessionKey.rootAddress,
        serviceURL: 'https://calib.ezpdpz.net',
        cdn: false,
      })
      p.log.info(
        `Waiting for tx ${hashLink(result.txHash, chain)} to be mined...`
      )
      const dataset = await waitForCreateDataSet(result)
      p.log.info(`Data set created #${dataset.dataSetId}`)
    } else {
      p.log.error('Session key does not have permission to create data set')
    }

    // const { event: revokeEvent } = await SessionKey.revokeSync(client, {
    //   address: sessionKey.address,
    //   onHash(hash) {
    //     p.log.info(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
    //   },
    // })
    // console.log('🚀 ~ event revoked:', revokeEvent.args)
    sessionKey.disconnect()
    // try {
    // } catch (error) {
    //   if (argv.flags.debug) {
    //     console.error(error)
    //   } else {
    //     p.log.error((error as Error).message)
    //   }
    // }
  }
)
