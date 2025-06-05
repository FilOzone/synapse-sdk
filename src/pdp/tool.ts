/**
 * PDPTool handles communication with PDP servers for proof set operations
 */

import { ethers } from 'ethers'
import type { PDPAuthHelper } from './auth.js'
import type { CommP } from '../types.js'
import { asCommP } from '../commp/index.js'

/**
 * Response from creating a proof set
 */
export interface CreateProofSetResponse {
  /** Transaction hash for the proof set creation */
  txHash: string
  /** URL to check creation status */
  statusUrl: string
}

/**
 * Response from checking proof set creation status
 */
export interface ProofSetCreationStatusResponse {
  /** Transaction hash that created the proof set */
  createMessageHash: string
  /** Whether the proof set has been created on-chain */
  proofsetCreated: boolean
  /** Service label that created the proof set */
  service: string
  /** Transaction status (pending, confirmed, failed) */
  txStatus: string
  /** Whether the transaction was successful (null if still pending) */
  ok: boolean | null
  /** On-chain proof set ID (only available after creation) */
  proofSetId?: number
}

/**
 * Root entry for adding to proof sets
 */
export interface AddRootEntry {
  /** The root CID for the data being added */
  rootCid: CommP | string
  /** Array of subroot (piece) CIDs that make up this root */
  subroots: SubrootEntry[]
}

/**
 * Subroot entry within a root
 */
export interface SubrootEntry {
  /** The piece CID for this subroot */
  subrootCid: CommP | string
}

/**
 * PDPTool provides methods for interacting with PDP servers
 */
export class PDPTool {
  private readonly apiEndpoint: string
  private readonly pdpAuthHelper: PDPAuthHelper

  /**
   * Create a new PDPTool instance
   * @param apiEndpoint - The root URL of the PDP API endpoint (e.g., 'https://pdp.example.com')
   * @param pdpAuthHelper - PDPAuthHelper instance for generating signatures
   */
  constructor (apiEndpoint: string, pdpAuthHelper: PDPAuthHelper) {
    // Validate and normalize API endpoint (remove trailing slash)
    if (apiEndpoint === '') {
      throw new Error('PDP API endpoint is required')
    }
    this.apiEndpoint = apiEndpoint.endsWith('/') ? apiEndpoint.slice(0, -1) : apiEndpoint

    this.pdpAuthHelper = pdpAuthHelper
  }

  /**
   * Create a new proof set on the PDP server
   * @param clientDataSetId - Unique ID for the client's dataset
   * @param payee - Address that will receive payments (storage provider)
   * @param withCDN - Whether to enable CDN services
   * @param recordKeeper - Address of the Pandora contract
   * @returns Promise that resolves with transaction hash and status URL
   */
  async createProofSet (
    clientDataSetId: number,
    payee: string,
    withCDN: boolean,
    recordKeeper: string
  ): Promise<CreateProofSetResponse> {
    // Generate the EIP-712 signature for proof set creation
    const authData = await this.pdpAuthHelper.signCreateProofSet(clientDataSetId, payee, withCDN)

    // Prepare the extra data for the contract call
    // This needs to match the ProofSetCreateData struct in Pandora contract
    const extraData = this._encodeProofSetCreateData({
      metadata: '', // Empty metadata for now
      payer: await this.pdpAuthHelper.getSignerAddress(),
      withCDN,
      signature: authData.signature
    })

    // Prepare request body
    const requestBody = {
      recordKeeper,
      extraData: `0x${extraData}`
    }

    // Make the POST request to create the proof set
    const response = await fetch(`${this.apiEndpoint}/pdp/proof-sets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (response.status !== 201) {
      const errorText = await response.text()
      throw new Error(`Failed to create proof set: ${response.status} ${response.statusText} - ${errorText}`)
    }

    // Extract transaction hash from Location header
    const location = response.headers.get('Location')
    if (location == null) {
      throw new Error('Server did not provide Location header in response')
    }

    // Parse the location to extract the transaction hash
    // Expected format: /pdp/proof-sets/created/{txHash}
    const locationMatch = location.match(/\/pdp\/proof-sets\/created\/(.+)$/)
    if (locationMatch == null) {
      throw new Error(`Invalid Location header format: ${location}`)
    }

    const txHash = locationMatch[1]

    return {
      txHash,
      statusUrl: `${this.apiEndpoint}${location}`
    }
  }

  /**
   * Check the status of a proof set creation
   * @param txHash - Transaction hash from createProofSet
   * @returns Promise that resolves with the creation status
   */
  async getProofSetCreationStatus (txHash: string): Promise<ProofSetCreationStatusResponse> {
    const response = await fetch(`${this.apiEndpoint}/pdp/proof-sets/created/${txHash}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (response.status === 404) {
      throw new Error(`Proof set creation not found for transaction hash: ${txHash}`)
    }

    if (response.status !== 200) {
      const errorText = await response.text()
      throw new Error(`Failed to get proof set creation status: ${response.status} ${response.statusText} - ${errorText}`)
    }

    return await response.json() as ProofSetCreationStatusResponse
  }

  /**
   * Add roots to an existing proof set
   * @param proofSetId - The ID of the proof set to add roots to
   * @param clientDataSetId - The client's dataset ID used when creating the proof set
   * @param rootEntries - Array of root entries to add. Both rootCid and subrootCid accept CommP objects or string CIDs
   * @param metadata - Optional metadata for the roots
   * @returns Promise that resolves when the roots are added (201 Created)
   * @throws Error if any CID is invalid or if roots have no subroots
   *
   * @example
   * ```typescript
   * const rootEntries = [{
   *   rootCid: 'baga6ea4seaq...', // String CID
   *   subroots: [
   *     { subrootCid: commPObject }, // CommP object
   *     { subrootCid: 'baga6ea4seaq...' } // String CID
   *   ]
   * }]
   * await pdpTool.addRoots(proofSetId, clientDataSetId, rootEntries)
   * ```
   */
  async addRoots (
    proofSetId: number,
    clientDataSetId: number,
    rootEntries: AddRootEntry[],
    metadata?: string
  ): Promise<void> {
    if (rootEntries.length === 0) {
      throw new Error('At least one root entry must be provided')
    }

    // Convert AddRootEntry to RootData for signature
    const rootDataForSignature = []
    for (const entry of rootEntries) {
      if (entry.subroots.length === 0) {
        throw new Error('Each root must have at least one subroot')
      }

      // Validate root CommP
      const rootCommP = asCommP(entry.rootCid)
      if (rootCommP == null) {
        throw new Error(`Invalid root CommP: ${String(entry.rootCid)}`)
      }

      // Validate subroot CommPs
      for (const subroot of entry.subroots) {
        const subrootCommP = asCommP(subroot.subrootCid)
        if (subrootCommP == null) {
          throw new Error(`Invalid subroot CommP: ${String(subroot.subrootCid)}`)
        }
      }

      // For signature purposes, we need to calculate the total raw size
      // Since we don't have the raw sizes here, we'll need to fetch them from the server
      // For now, we'll use a placeholder approach - the server will validate the rootCid anyway
      rootDataForSignature.push({
        cid: entry.rootCid, // PDPAuthHelper.signAddRoots accepts CommP | string
        rawSize: 0 // The server will calculate this from the subroots
      })
    }

    // Generate the EIP-712 signature for adding roots
    // Note: firstAdded is not used in the HTTP API, only in direct contract calls
    // The server determines the next root ID automatically
    const authData = await this.pdpAuthHelper.signAddRoots(
      clientDataSetId,
      0, // firstAdded - not used by HTTP API but required by signature
      rootDataForSignature
    )

    // Prepare the extra data for the contract call
    // This needs to match what the Pandora contract expects for addRoots
    const extraData = this._encodeAddRootsExtraData({
      signature: authData.signature,
      metadata: metadata ?? ''
    })

    // Prepare request body matching the Curio handler expectation
    // Convert CommP objects to strings for JSON serialization
    const requestBody = {
      roots: rootEntries.map(entry => ({
        rootCid: typeof entry.rootCid === 'string' ? entry.rootCid : entry.rootCid.toString(),
        subroots: entry.subroots.map(subroot => ({
          subrootCid: typeof subroot.subrootCid === 'string' ? subroot.subrootCid : subroot.subrootCid.toString()
        }))
      })),
      extraData: `0x${extraData}`
    }

    // Make the POST request to add roots to the proof set
    const response = await fetch(`${this.apiEndpoint}/pdp/proof-sets/${proofSetId}/roots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (response.status !== 201) {
      const errorText = await response.text()
      throw new Error(`Failed to add roots to proof set: ${response.status} ${response.statusText} - ${errorText}`)
    }

    // Success - roots have been added
  }

  /**
   * Get the API endpoint
   */
  getApiEndpoint (): string {
    return this.apiEndpoint
  }

  /**
   * Get the PDPAuthHelper instance
   */
  getPDPAuthHelper (): PDPAuthHelper {
    return this.pdpAuthHelper
  }

  /**
   * Encode ProofSetCreateData for extraData field
   * This matches the Solidity struct ProofSetCreateData in Pandora contract
   */
  private _encodeProofSetCreateData (data: {
    metadata: string
    payer: string
    withCDN: boolean
    signature: string
  }): string {
    // Use ethers ABI encoding to match the Solidity struct
    // ProofSetCreateData struct:
    // - string metadata
    // - address payer
    // - bool withCDN
    // - bytes signature

    // Ensure signature has 0x prefix
    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`

    // ABI encode the struct as a tuple
    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(
      ['string', 'address', 'bool', 'bytes'],
      [data.metadata, data.payer, data.withCDN, signature]
    )

    // Return hex string without 0x prefix (since we add it in the calling code)
    return encoded.slice(2)
  }

  /**
   * Encode AddRoots extraData for the addRoots operation
   * Based on the Curio handler, this should be (bytes signature, string metadata)
   */
  private _encodeAddRootsExtraData (data: {
    signature: string
    metadata: string
  }): string {
    // Ensure signature has 0x prefix
    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`

    // ABI encode as (bytes signature, string metadata)
    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(
      ['bytes', 'string'],
      [signature, data.metadata]
    )

    // Return hex string without 0x prefix (since we add it in the calling code)
    return encoded.slice(2)
  }
}
