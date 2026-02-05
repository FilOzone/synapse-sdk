/**
 * SessionKey - Tracks the user's approval of a session key
 *
 * Session keys allow the user to authorize an app to take actions on
 * their behalf without prompting their wallet for signatures.
 * Session keys have a scope and an expiration.
 * Session keys should be generated on the user's computer and persisted
 * in a safe place or discarded.
 *
 * @example
 * ```typescript
 * const sessionKey = synapse.createSessionkey(privateKey)
 * const expiries = await sessionKey.fetchExpiries([ADD_PIECES_TYPEHASH])
 * if (expiries[ADD_PIECES_TYPEHASH] * BigInt(1000) < BigInt(Date.now()) + HOUR_MILLIS) {
 *   const DAY_MILLIS = BigInt(24) * HOUR_MILLIS
 *   const loginTx = await sessionKey.login(BigInt(Date.now()) / BigInt(1000 + 30 * DAY_MILLIS), PDP_PERMISSIONS, "example.com")
 *   const loginReceipt = await loginTx.wait()
 * }
 * synapse.setSession(sessionKey)
 * const context = await synapse.storage.createContext()
 * ```
 */

import { asChain } from '@filoz/synapse-core/chains'
import * as SK from '@filoz/synapse-core/session-key'
import { type Account, type Chain, type Client, createWalletClient, type Hash, http, type Transport } from 'viem'
import { multicall } from 'viem/actions'

const DEFAULT_ORIGIN: string = (globalThis as any).location?.hostname || 'unknown'

export class SessionKey {
  private readonly _ownerClient: Client<Transport, Chain, Account>
  private readonly _client: Client<Transport, Chain, Account>
  private readonly _account: Account
  private readonly _chain: Chain

  public constructor(client: Client<Transport, Chain, Account>, account: Account) {
    this._ownerClient = client
    this._account = account
    this._chain = asChain(client.chain)
    this._client = createWalletClient({
      chain: this._chain,
      transport: http(),
      account: this._account,
    })
  }

  get account(): Account {
    return this._account
  }

  get chain(): Chain {
    return this._chain
  }

  get client(): Client<Transport, Chain, Account> {
    return this._client
  }

  /**
   * Queries current permission expiries from the registry
   * @param permissions Expiries to fetch, as a list of bytes32 hex strings
   * @return map of each permission to its expiry for this session key
   */
  async fetchExpiries(
    permissions: SK.SessionKeyPermissions[] = SK.ALL_PERMISSIONS
  ): Promise<Record<SK.SessionKeyPermissions, bigint>> {
    const expiries: Record<string, bigint> = {}
    const result = await multicall(this._ownerClient, {
      allowFailure: false,
      contracts: permissions.map((permission) =>
        SK.authorizationExpiryCall({
          chain: this._chain,
          address: this._ownerClient.account.address,
          sessionKeyAddress: this._account.address,
          permission,
        })
      ),
    })

    for (let i = 0; i < permissions.length; i++) {
      expiries[permissions[i]] = result[i]
    }

    return expiries
  }

  /**
   * Authorize signer with permissions until expiry. This can also be used to
   * renew existing authorization by updating the expiry.
   *
   * @param expiry unix time (block.timestamp) that the permissions expire
   * @param permissions list of permissions granted to the signer, as a list of bytes32 hex strings
   * @param origin the name of the application prompting this login
   * @return signed and broadcasted login transaction details
   */
  async login(
    expiry: bigint,
    permissions: SK.SessionKeyPermissions[] = SK.ALL_PERMISSIONS,
    origin = DEFAULT_ORIGIN
  ): Promise<Hash> {
    return await SK.login(this._ownerClient, {
      address: this._account.address,
      expiresAt: expiry,
      permissions,
      origin,
    })
  }

  /**
   * Invalidate signer permissions, setting their expiry to zero.
   *
   * @param permissions list of permissions removed from the signer, as a list of bytes32 hex strings
   * @return signed and broadcasted revoke transaction details
   */
  async revoke(permissions: SK.SessionKeyPermissions[] = SK.ALL_PERMISSIONS, origin = DEFAULT_ORIGIN): Promise<Hash> {
    return await SK.revoke(this._ownerClient, {
      address: this._account.address,
      permissions,
      origin,
    })
  }
}
