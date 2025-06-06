/**
 * PDPService - Handles non-payment related interactions with Pandora contracts
 *
 * This is a standalone utility for querying proof sets and other Pandora contract state.
 *
 * @example
 * ```typescript
 * import { PDPService } from '@filoz/synapse-sdk/pdp'
 * import { ethers } from 'ethers'
 *
 * const provider = new ethers.JsonRpcProvider(rpcUrl)
 * const pdpService = new PDPService(provider, pandoraAddress)
 *
 * // Get proof sets for a client
 * const proofSets = await pdpService.getClientProofSets(clientAddress)
 * console.log(`Client has ${proofSets.length} proof sets`)
 * ```
 */

import { ethers } from 'ethers'
import type { ProofSetInfo } from '../types.js'
import { CONTRACT_ABIS } from '../utils/index.js'

export class PDPService {
  private readonly _provider: ethers.Provider
  private readonly _pandoraAddress: string
  private _pandoraContract: ethers.Contract | null = null

  constructor (provider: ethers.Provider, pandoraAddress: string) {
    this._provider = provider
    this._pandoraAddress = pandoraAddress
  }

  /**
   * Get cached Pandora contract instance or create new one
   */
  private _getPandoraContract (): ethers.Contract {
    if (this._pandoraContract == null) {
      this._pandoraContract = new ethers.Contract(
        this._pandoraAddress,
        CONTRACT_ABIS.PANDORA_SERVICE,
        this._provider
      )
    }
    return this._pandoraContract
  }

  /**
   * Get all proof sets for a given client address
   * @param clientAddress - The client's wallet address
   * @returns Array of proof set information
   */
  async getClientProofSets (clientAddress: string): Promise<ProofSetInfo[]> {
    const pandoraContract = this._getPandoraContract()

    try {
      // Call the getClientProofSets function on the contract
      const proofSetsData = await pandoraContract.getClientProofSets(clientAddress)

      // Map the raw data to our ProofSetInfo interface
      const proofSets: ProofSetInfo[] = []

      // The contract returns an array of structs, we need to map them
      for (let i = 0; i < proofSetsData.length; i++) {
        const data = proofSetsData[i]

        proofSets.push({
          railId: Number(data.railId),
          payer: data.payer,
          payee: data.payee,
          commissionBps: Number(data.commissionBps),
          metadata: data.metadata,
          rootMetadata: data.rootMetadata, // This is already an array of strings
          clientDataSetId: Number(data.clientDataSetId),
          withCDN: data.withCDN
        })
      }

      return proofSets
    } catch (error) {
      throw new Error(`Failed to get client proof sets: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
