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

import { ethers } from 'ethers'
import { EIP712_TYPE_HASHES } from '../utils/eip712.ts'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES, getFilecoinNetworkType } from '../utils/index.ts'

export const CREATE_DATA_SET_TYPEHASH = EIP712_TYPE_HASHES.CreateDataSet
export const ADD_PIECES_TYPEHASH = EIP712_TYPE_HASHES.AddPieces
export const SCHEDULE_PIECE_REMOVALS_TYPEHASH = EIP712_TYPE_HASHES.SchedulePieceRemovals
export const DELETE_DATA_SET_TYPEHASH = EIP712_TYPE_HASHES.DeleteDataSet

// These are the PDP-related permissions that can be granted to a session key.
// They are bytes32 hex strings that can be supplied to fetchExpiries, login, and revoke.
export const PDP_PERMISSIONS = [
  CREATE_DATA_SET_TYPEHASH,
  ADD_PIECES_TYPEHASH,
  SCHEDULE_PIECE_REMOVALS_TYPEHASH,
  DELETE_DATA_SET_TYPEHASH,
]

export const PDP_PERMISSION_NAMES: Record<string, string> = {
  [CREATE_DATA_SET_TYPEHASH]: 'CreateDataSet',
  [ADD_PIECES_TYPEHASH]: 'AddPieces',
  [SCHEDULE_PIECE_REMOVALS_TYPEHASH]: 'SchedulePieceRemovals',
  [DELETE_DATA_SET_TYPEHASH]: 'DeleteDataSet',
}

const DEFAULT_ORIGIN: string = (globalThis as any).location?.hostname || 'unknown'

export class SessionKey {
  private readonly _provider: ethers.Provider
  private readonly _registry: ethers.Contract
  private readonly _signer: ethers.Signer
  private readonly _owner: ethers.Signer

  public constructor(
    provider: ethers.Provider,
    sessionKeyRegistryAddress: string,
    signer: ethers.Signer,
    owner: ethers.Signer
  ) {
    this._provider = provider
    this._registry = new ethers.Contract(sessionKeyRegistryAddress, CONTRACT_ABIS.SESSION_KEY_REGISTRY, owner)
    this._signer = signer
    this._owner = owner
  }

  getSigner(): ethers.Signer {
    return this._signer
  }

  /**
   * Queries current permission expiries from the registry
   * @param permissions Expiries to fetch, as a list of bytes32 hex strings
   * @return map of each permission to its expiry for this session key
   */
  async fetchExpiries(permissions: string[] = PDP_PERMISSIONS): Promise<Record<string, bigint>> {
    const network = await getFilecoinNetworkType(this._provider)

    const multicall = new ethers.Contract(
      CONTRACT_ADDRESSES.MULTICALL3[network],
      CONTRACT_ABIS.MULTICALL3,
      this._provider
    )
    const registryInterface = new ethers.Interface(CONTRACT_ABIS.SESSION_KEY_REGISTRY)

    const [ownerAddress, signerAddress, registryAddress] = await Promise.all([
      this._owner.getAddress(),
      this._signer.getAddress(),
      this._registry.getAddress(),
    ])

    // Prepare multicall batch
    const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = []
    for (const permission of permissions) {
      calls.push({
        target: registryAddress,
        allowFailure: true,
        callData: registryInterface.encodeFunctionData('authorizationExpiry', [
          ownerAddress,
          signerAddress,
          permission,
        ]),
      })
    }

    // Execute multicall
    const results = await multicall.aggregate3.staticCall(calls)

    const expiries: Record<string, bigint> = {}
    for (let i = 0; i < permissions.length; i++) {
      expiries[PDP_PERMISSIONS[i]] = registryInterface.decodeFunctionResult(
        'authorizationExpiry',
        results[i].returnData
      )[0]
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
    permissions: string[] = PDP_PERMISSIONS,
    origin = DEFAULT_ORIGIN
  ): Promise<ethers.TransactionResponse> {
    return await this._registry.login(await this._signer.getAddress(), expiry, permissions, origin)
  }

  /**
   * Invalidate signer permissions, setting their expiry to zero.
   *
   * @param permissions list of permissions removed from the signer, as a list of bytes32 hex strings
   * @return signed and broadcasted revoke transaction details
   */
  async revoke(permissions: string[] = PDP_PERMISSIONS): Promise<ethers.TransactionResponse> {
    return await this._registry.revoke(await this._signer.getAddress(), permissions)
  }
}
