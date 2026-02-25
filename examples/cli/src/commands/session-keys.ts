import * as p from '@clack/prompts'
import * as SessionKey from '@filoz/synapse-core/session-key'
import { createDataSet, waitForCreateDataSet } from '@filoz/synapse-core/sp'
import { type Command, command } from 'cleye'
import { type Hex, stringify } from 'viem'
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
    const sessionKey = SessionKey.fromSecp256k1({
      privateKey:
        '0xaa14e25eaea762df1533e72394b85e56dd0c7aa61cf6df3b1f13a842ca0361e5' as Hex,
      root: client.account,
      chain,
    })

    p.log.info(`Root address: ${sessionKey.account.rootAddress}`)
    p.log.info(`Session key address: ${sessionKey.account.address}`)

    sessionKey.on('expirationsUpdated', (e) => {
      p.log.warn('Expirations updated', e.detail)
    })
    sessionKey.on('connected', (e) => {
      p.log.success('Connected', e.detail)
    })
    sessionKey.on('disconnected', () => {
      p.log.warn('Disconnected')
    })
    sessionKey.on('error', (e) => {
      p.log.error(e.detail.message)
    })

    const { event: loginEvent } = await SessionKey.loginSync(client, {
      address: sessionKey.address,
      onHash(hash) {
        p.log.step(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
      },
    })
    p.log.success(`Login event: ${stringify(loginEvent.args)}`)

    await sessionKey.watch()

    if (sessionKey.hasPermission(SessionKey.CreateDataSetPermission)) {
      const result = await createDataSet(sessionKey.client, {
        payee: '0xa3971A7234a3379A1813d9867B531e7EeB20ae07',
        payer: sessionKey.rootAddress,
        serviceURL: 'https://calib.ezpdpz.net',
        cdn: false,
      })
      p.log.step(
        `Waiting for tx ${hashLink(result.txHash, chain)} to be mined...`
      )
      const dataset = await waitForCreateDataSet(result)
      p.log.success(`Data set created #${dataset.dataSetId}`)
    } else {
      p.log.error('Session key does not have permission to create data set')
    }

    const { event: revokeEvent } = await SessionKey.revokeSync(client, {
      address: sessionKey.address,
      onHash(hash) {
        p.log.step(`Waiting for tx ${hashLink(hash, chain)} to be mined...`)
      },
    })
    p.log.success(`Revoke event: ${stringify(revokeEvent.args)}`)
    sessionKey.unwatch()
  }
)
