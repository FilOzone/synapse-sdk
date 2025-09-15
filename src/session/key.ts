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
 * const sessionKey = synapse.setSession(privateKey)
 * await sessionKey.fetchExpiries()
 * if (sessionKey.expiries[ADD_PIECES_TYPEHASH] * 1000 < Date.now() + HOUR_MILLIS) {
 *   const DAY_MILLIS = 24 * HOUR_MILLIS
 *   await sessionKey.login(BigInt(Date.now() / 1000 + 30 * DAY_MILLIS), PDP_PERMISSIONS)
 * }
 * ```
 */

import { ethers } from 'ethers'
import { getEIP712TypeString } from '../utils/eip712.ts'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES, getFilecoinNetworkType } from '../utils/index.ts'

export const CREATE_DATA_SET_TYPEHASH = ethers.id(getEIP712TypeString('CreateDataSet'))
export const ADD_PIECES_TYPEHASH = ethers.id(getEIP712TypeString('AddPieces'))
export const SCHEDULE_PIECE_REMOVALS_TYPEHASH = ethers.id(getEIP712TypeString('SchedulePieceRemovals'))
export const DELETE_DATA_SET_TYPEHASH = ethers.id(getEIP712TypeString('DeleteDataSet'))

export const PDP_PERMISSIONS = [
  CREATE_DATA_SET_TYPEHASH,
  ADD_PIECES_TYPEHASH,
  SCHEDULE_PIECE_REMOVALS_TYPEHASH,
  DELETE_DATA_SET_TYPEHASH,
]

export class SessionKey {
  private readonly _provider: ethers.Provider
  private readonly _registry: ethers.Contract
  private readonly _signer: ethers.Signer
  private readonly _owner: ethers.Signer
  public readonly expiries: Record<string, bigint | null>

  public constructor(
    provider: ethers.Provider,
    sessionKeyRegistry: ethers.Contract,
    signer: ethers.Signer,
    owner: ethers.Signer
  ) {
    this._provider = provider
    this._registry = sessionKeyRegistry
    this._signer = signer
    this._owner = owner
    this.expiries = {
      CREATE_DATA_SET_TYPEHASH: null,
      ADD_PIECES_TYPEHASH: null,
      SCHEDULE_PIECE_REMOVALS_TYPEHASH: null,
      DELETE_DATA_SET_TYPEHASH: null,
    }
  }

  getSigner(): ethers.Signer {
    return this._signer
  }

  /**
   * Refreshes SessionKey.expiries by fetching the expiries of those permissions from the registry
   */
  async fetchExpiries(): Promise<void> {
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
    for (const permission of PDP_PERMISSIONS) {
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

    for (let i = 0; i < PDP_PERMISSIONS.length; i++) {
      this.expiries[PDP_PERMISSIONS[i]] = registryInterface.decodeFunctionResult(
        'authorizationExpiry',
        results[i].returnData
      )[0]
    }
  }

  /**
   * Owner authorizes signer with permissions until expiry
   * @param expiry unix time (block.timestamp) that the permissions expire
   * @param permissions list of permissions granted to the signer
   */
  async login(expiry: bigint, permissions: string[] = PDP_PERMISSIONS): Promise<void> {
    await this._registry.login(await this._signer.getAddress(), expiry, permissions)
  }
}
