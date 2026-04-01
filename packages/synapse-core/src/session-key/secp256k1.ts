import { TypedEventTarget } from 'iso-web/event-target'
import {
  type Chain,
  type Client,
  createClient,
  type FallbackTransport,
  type Hex,
  type HttpTransport,
  http,
  type Transport,
  type WatchContractEventReturnType,
  type WebSocketTransport,
} from 'viem'
import { type Account, type Address, privateKeyToAccount } from 'viem/accounts'
import { watchContractEvent } from 'viem/actions'
import { asChain, type Chain as SynapseChain } from '../chains.ts'
import { getExpirations } from './authorization-expiry.ts'
import { extractLoginEvent } from './login.ts'
import { DefaultEmptyExpirations, type Expirations, type Permission } from './permissions.ts'
import type { SessionKey, SessionKeyAccount, SessionKeyEvents } from './types.ts'

interface Secp256k1SessionKeyOptions {
  client: Client<Transport, SynapseChain, SessionKeyAccount<'Secp256k1'>>
  expirations: Expirations
}

/**
 * Secp256k1SessionKey - A session key for a secp256k1 private key.
 */
export class Secp256k1SessionKey extends TypedEventTarget<SessionKeyEvents> implements SessionKey<'Secp256k1'> {
  #client: Client<Transport, SynapseChain, SessionKeyAccount<'Secp256k1'>>
  #type: 'Secp256k1'
  #expirations: Expirations
  #unsubscribe: WatchContractEventReturnType | undefined

  /**
   * Create a new Secp256k1SessionKey.
   * @param options - {@link Secp256k1SessionKeyOptions}
   */
  constructor(options: Secp256k1SessionKeyOptions) {
    super()
    this.#type = 'Secp256k1'
    this.#expirations = options.expirations
    this.#client = options.client
  }

  get client() {
    return this.#client
  }

  get type() {
    return this.#type
  }

  get expirations() {
    return this.#expirations
  }

  get address() {
    return this.#client.account.address
  }

  get rootAddress() {
    return this.#client.account.rootAddress
  }

  get account() {
    return this.#client.account
  }

  async watch() {
    await this.syncExpirations()

    if (!this.#unsubscribe) {
      this.#unsubscribe = watchContractEvent(this.client, {
        address: this.#client.chain.contracts.sessionKeyRegistry.address,
        abi: this.#client.chain.contracts.sessionKeyRegistry.abi,
        eventName: 'AuthorizationsUpdated',
        args: { identity: this.#client.account.rootAddress },
        onError: this.emit.bind(this, 'error'),
        onLogs: (logs) => {
          try {
            const event = extractLoginEvent(logs)
            if (event.args.identity === this.#client.account.rootAddress) {
              for (const hash of event.args.permissions) {
                this.#expirations[hash] = event.args.expiry
              }
              this.emit('expirationsUpdated', this.#expirations)
            }
          } catch (error) {
            this.emit('error', error as Error)
          }
        },
      })
      this.emit('connected', this.#expirations)
    }
    return () => {
      this.unwatch()
    }
  }

  unwatch() {
    if (this.#unsubscribe) {
      this.#unsubscribe()
      this.#unsubscribe = undefined
      this.emit('disconnected')
    }
  }

  /**
   * Check if the session key has a permission.
   *
   * @param permission - {@link Permission}
   * @returns boolean
   */
  hasPermission(permission: Permission) {
    return this.expirations[permission] > BigInt(Math.floor(Date.now() / 1000))
  }

  /**
   * Check if the session key has all the permissions.
   *
   * @param permissions - {@link Permission}
   * @returns boolean - True if the session key has all the permissions, false otherwise.
   */
  hasPermissions(permissions: Permission[]) {
    return permissions.every((permission) => this.hasPermission(permission))
  }

  /**
   * Sync the expirations of the session key from the contract.
   *
   * @param permissions - The permissions to sync the expirations for. Defaults to all FWSS permissions.
   * @returns Promise<void>
   * @throws Errors {@link getExpirations.ErrorType}
   */
  async syncExpirations(permissions?: Permission[]) {
    this.#expirations = await getExpirations(this.#client, {
      address: this.#client.account.rootAddress,
      sessionKeyAddress: this.#client.account.address,
      permissions: permissions,
    })
    this.emit('expirationsUpdated', this.#expirations)
  }
}

export interface FromSecp256k1Options {
  privateKey: Hex
  expirations?: Expirations
  root: Account | Address
  transport?: HttpTransport | WebSocketTransport | FallbackTransport
  chain: Chain
}

/**
 * Create a session key from a secp256k1 private key.
 *
 * @param options - {@link FromSecp256k1Options}
 * @returns SessionKey {@link SessionKey}
 *
 * @example
 * ```ts
 * import { SessionKey, Account } from '@filoz/synapse-core/session-key'
 * import { mainnet } from '@filoz/synapse-core/chains'
 * import type { Hex } from 'viem'
 *
 * const account = Account.fromSecp256k1({
 *   privateKey: '0xaa14e25eaea762df1533e72394b85e56dd0c7aa61cf6df3b1f13a842ca0361e5' as Hex,
 *   rootAddress: '0x1234567890123456789012345678901234567890',
 * })
 * const sessionKey = SessionKey.fromSecp256k1({
 *   account,
 *   chain: mainnet,
 * })
 * ```
 */
export function fromSecp256k1(options: FromSecp256k1Options) {
  const rootAddress = typeof options.root === 'string' ? options.root : options.root.address

  if (rootAddress === undefined) {
    throw new Error('Root address is required')
  }

  const account = accountFromSecp256k1({
    privateKey: options.privateKey,
    rootAddress: rootAddress,
  })

  const chain = asChain(options.chain)

  const client = createClient<Transport, SynapseChain, SessionKeyAccount<'Secp256k1'>>({
    chain: chain,
    transport: options.transport ?? http(),
    account,
    name: 'Secp256k1 Session Key',
    key: 'secp256k1-session-key',
    type: 'sessionClient',
  })

  return new Secp256k1SessionKey({
    client: client,
    expirations: options.expirations ?? DefaultEmptyExpirations,
  })
}

export interface AccountFromSecp256k1Options {
  privateKey: Hex
  rootAddress: Address
}

/**
 * Create a session key account from a secp256k1 private key.
 *
 * @param options - {@link AccountFromSecp256k1Options}
 * @returns Account {@link SessionKeyAccount}
 *
 * @example
 * ```ts
 * import { Account } from '@filoz/synapse-core/session-key'
 * import type { Hex } from 'viem'
 *
 * const account = Account.fromSecp256k1({
 *   privateKey: '0xaa14e25eaea762df1533e72394b85e56dd0c7aa61cf6df3b1f13a842ca0361e5' as Hex,
 *   rootAddress: '0x1234567890123456789012345678901234567890',
 * })
 * ```
 */
export function accountFromSecp256k1(options: AccountFromSecp256k1Options) {
  const account: SessionKeyAccount<'Secp256k1'> = {
    ...privateKeyToAccount(options.privateKey),
    source: 'sessionKey',
    keyType: 'Secp256k1',
    rootAddress: options.rootAddress,
  }
  return account
}
