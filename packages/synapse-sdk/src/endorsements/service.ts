import { asChain, type Chain as SynapseChain } from '@filoz/synapse-core/chains'
import type { Chain, Client, Transport } from 'viem'
import { readContract } from 'viem/actions'

/**
 * Endorsed storage providers have a strong durability record and are held to higher standards.
 * A ProviderIdSet smart contract governs the membership of this group.
 */
export class EndorsementsService {
  private readonly _client: Client<Transport, Chain>
  private readonly _chain: SynapseChain
  private _endorsedProviderIds: Set<bigint> | null = null

  constructor(client: Client<Transport, Chain>) {
    this._client = client
    this._chain = asChain(client.chain)
  }

  /**
   *
   * @returns Array of endorsed storage provider ids
   */
  async getEndorsedProviderIds(): Promise<Set<bigint>> {
    if (this._endorsedProviderIds == null) {
      const endorsedProviderIds = await readContract(this._client, {
        address: this._chain.contracts.endorsements.address,
        abi: this._chain.contracts.endorsements.abi,
        functionName: 'getProviderIds',
      })
      this._endorsedProviderIds = new Set(endorsedProviderIds)
    }
    return this._endorsedProviderIds
  }
}
