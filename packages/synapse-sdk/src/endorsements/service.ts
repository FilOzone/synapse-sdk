import { ethers } from 'ethers'
import { CONTRACT_ABIS } from '../utils/index.ts'

/**
 * Endorsed storage providers have a strong durability record and are held to higher standards.
 * A ProviderIdSet smart contract governs the membership of this group.
 */
export class EndorsementsService {
  private readonly _endorsementsContract: ethers.Contract
  private _endorsedProviderIds: Set<number> | null = null

  constructor(provider: ethers.Provider, endorsementsAddress: string) {
    this._endorsementsContract = new ethers.Contract(endorsementsAddress, CONTRACT_ABIS.ENDORSEMENTS, provider)
  }

  /**
   *
   * @returns Array of endorsed storage provider ids
   */
  async getEndorsedProviderIds(): Promise<Set<number>> {
    if (this._endorsedProviderIds == null) {
      const endorsedProviderIds = await this._endorsementsContract.getProviderIds()
      this._endorsedProviderIds = new Set(endorsedProviderIds)
      return endorsedProviderIds
    } else {
      return this._endorsedProviderIds
    }
  }
}
