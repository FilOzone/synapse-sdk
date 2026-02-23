import type { TypedEventTarget } from 'iso-web/event-target'
import type { Simplify } from 'type-fest'
import type { Account, Address, Client, CustomSource, LocalAccount, Transport } from 'viem'
import type { Chain as SynapseChain } from '../chains.ts'
import type { Expirations, Permission } from './permissions.ts'

export type SessionKeyEvents = {
  expirationsUpdated: CustomEvent<Expirations>
  connected: CustomEvent<Expirations>
  disconnected: CustomEvent<void>
  error: CustomEvent<Error>
}

export type SessionKeyType = 'Secp256k1' | 'P-256'

export type SessionKeyAccount<T extends SessionKeyType> = Simplify<
  LocalAccount<'sessionKey'> & {
    sign: NonNullable<CustomSource['sign']>
    signAuthorization: NonNullable<CustomSource['signAuthorization']>
    keyType: T
    rootAddress: Address
  }
>

export interface SessionKey<KeyType extends SessionKeyType> extends TypedEventTarget<SessionKeyEvents> {
  readonly client: Client<Transport, SynapseChain, SessionKeyAccount<KeyType>>
  readonly address: Address
  readonly rootAddress: Address
  readonly account: Account
  readonly type: KeyType
  readonly expirations: Expirations
  hasPermission: (permission: Permission) => boolean
  syncExpirations: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => void
}
