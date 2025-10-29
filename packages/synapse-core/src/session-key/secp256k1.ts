import { TypedEventTarget } from 'iso-web/event-target'
import type { Hex } from 'ox/Hex'
import {
  type Chain,
  type Client,
  createWalletClient,
  type TransactionReceipt,
  type Transport,
  type TransportConfig,
  type WalletClient,
} from 'viem'
import { type Account, generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { waitForTransactionReceipt } from 'viem/actions'
import { transportFromTransportConfig } from '../utils/viem.ts'
import { isExpired, login } from './actions.ts'
import type { SessionKeyPermissions } from './permissions.ts'

export interface Secp256k1SessionKeyProps {
  privateKey: Hex
  expiresAt: number | undefined
  permissions: SessionKeyPermissions[]
}

export interface Secp256k1SessionKeyCreateOptions {
  privateKey?: Hex
  /**
   * The expiration time of the session key in seconds.
   * @default Date.now() / 1000 + 1 hour
   */
  expiresAt?: number
  permissions?: SessionKeyPermissions[]
}

export class Secp256k1Key extends TypedEventTarget<WalletEvents> implements SessionKey {
  private privateKey: Hex
  permissions: SessionKeyPermissions[]
  expiresAt: number | undefined
  type: 'secp256k1'
  account: Account
  private isConnecting: boolean = false
  private isConnected: boolean = false
  private connectPromise: Promise<TransactionReceipt | undefined> | undefined

  constructor(props: Secp256k1SessionKeyProps) {
    super()
    this.privateKey = props.privateKey
    this.expiresAt = props.expiresAt
    this.type = 'secp256k1'
    this.permissions = props.permissions
    this.account = privateKeyToAccount(this.privateKey)
  }

  static create(options?: Secp256k1SessionKeyCreateOptions) {
    const key = options?.privateKey ?? generatePrivateKey()
    return new Secp256k1Key({
      privateKey: key,
      expiresAt: options?.expiresAt,
      permissions: options?.permissions ?? ['CreateDataSet', 'AddPieces', 'SchedulePieceRemovals', 'DeleteDataSet'],
    })
  }

  get connecting() {
    return this.isConnecting
  }

  get connected() {
    return this.isConnected
  }

  async connect(client: Client<Transport, Chain, Account>) {
    if (this.isConnecting) {
      throw new Error('Already connecting')
    }
    this.isConnecting = true
    try {
      const _isExpired = await this.isValid(client, this.permissions[0])
      if (_isExpired) {
        const hash = await this.refresh(client)
        this.connectPromise = waitForTransactionReceipt(client, { hash }).then(
          (receipt) => {
            this.isConnected = true
            this.emit('connected', this.account)
            this.connectPromise = undefined
            return receipt
          },
          (error) => {
            this.connectPromise = undefined
            this.emit('error', new Error('Failed to wait for connect', { cause: error }))
            return undefined
          }
        )
      }
    } catch (error) {
      throw new Error('Failed to connect', { cause: error })
    } finally {
      this.isConnecting = false
    }
  }

  disconnect() {
    this.isConnected = false
    this.emit('disconnected')
    this.connectPromise = undefined
    return Promise.resolve()
  }

  async refresh(client: Client<Transport, Chain, Account>) {
    const hash = await login(client, {
      sessionAddress: this.account.address,
      permissions: this.permissions,
      expiresAt: this.expiresAt ? BigInt(this.expiresAt) : undefined,
    })
    return hash
  }

  async isValid(client: Client<Transport, Chain, Account>, permission: SessionKeyPermissions) {
    if (!this.permissions.includes(permission)) {
      return false
    }
    if (this.connectPromise) {
      await this.connectPromise
    }
    return isExpired(client, {
      address: client.account.address,
      sessionAddress: this.account.address,
      permission: permission,
    })
  }

  client(chain: Chain, transportConfig?: TransportConfig): WalletClient<Transport, Chain, Account> {
    if (!this.connected) {
      throw new Error('Not connected')
    }
    return createWalletClient({
      chain,
      transport: transportFromTransportConfig({ transportConfig }),
      account: this.account,
    })
  }
}

export type WalletEvents = {
  connected: CustomEvent<Account>
  disconnected: CustomEvent<void>
  connectHash: CustomEvent<Hex>
  error: CustomEvent<Error>
}

export interface SessionKey extends TypedEventTarget<WalletEvents> {
  readonly connecting: boolean
  readonly connected: boolean
  readonly account: Account | undefined
  readonly type: 'secp256k1'

  connect: (client: Client<Transport, Chain, Account>) => Promise<void>
  disconnect: () => Promise<void>
  refresh: (client: Client<Transport, Chain, Account>) => Promise<Hex>
  isValid: (client: Client<Transport, Chain, Account>, permission: SessionKeyPermissions) => Promise<boolean>
  client: (chain: Chain, transportConfig?: TransportConfig) => WalletClient<Transport, Chain, Account>
}
