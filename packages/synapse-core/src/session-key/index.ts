/**
 * Session Key Contract Operations
 *
 * @example
 * ```ts
 * import * as SessionKey from '@filoz/synapse-core/session-key'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { type Hex } from 'viem'
 * import { mainnet } from '@filoz/synapse-core/chains'
 *
 * const rootAccount = privateKeyToAccount('0xaa14e25eaea762df1533e72394b85e56dd0c7aa61cf6df3b1f13a842ca0361e5' as Hex)
 *
 * const sessionKey = SessionKey.fromSecp256k1({
 *   privateKey: '0xaa14e25eaea762df1533e72394b85e56dd0c7aa61cf6df3b1f13a842ca0361e5' as Hex,
 *   root: rootAccount,
 *   chain: mainnet,
 * })
 * sessionKey.on('expirationsUpdated', (e) => {console.log(e.detail)})
 * sessionKey.on('connected', (e) => {console.log(e.detail)})
 * sessionKey.on('disconnected', () => {console.log('disconnected')})
 * sessionKey.on('error', (e) => {console.log(e.detail)})
 *
 *
 * const { event: loginEvent } = await SessionKey.loginSync(client, {
 *   address: sessionKey.address,
 *   onHash(hash) {
 *     console.log(`Waiting for tx ${hash} to be mined...`)
 *   },
 * })
 *
 * console.log('event login:', loginEvent.args)
 *
 * await sessionKey.connect()
 *
 * if(sessionKey.hasPermission('CreateDataSet')) {
 *   const hash = await createDataSet(sessionKey.client, {
 *     payee: '0x1234567890123456789012345678901234567890',
 *     payer: sessionKey.rootAddress,
 *     serviceURL: 'https://example.com',
 *   })
 *   console.log('event created dataset:', hash)
 * }
 *
 * const { event: revokeEvent } = await SessionKey.revokeSync(client, {
 *   address: sessionKey.address,
 *   onHash(hash) {
 *     console.log(`Waiting for tx ${hash} to be mined...`)
 *   },
 * })
 * console.log('event revoked:', revokeEvent.args)
 * sessionKey.disconnect()
 * ```
 *
 * @module session-key
 */

export * from './authorization-expiry.ts'
export * from './login.ts'
export * from './permissions.ts'
export * from './revoke.ts'
export type { AccountFromSecp256k1Options, FromSecp256k1Options } from './secp256k1.ts'
export { accountFromSecp256k1, fromSecp256k1 } from './secp256k1.ts'
export * from './types.ts'
