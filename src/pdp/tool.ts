/**
 * PDPTool handles communication with PDP servers for proof set operations
 */

import { ethers } from 'ethers'
import type { PDPAuthHelper } from './auth.js'
import type { RootData } from '../types.js'
import type { ProofSetCreationVerification } from './service.js'
import { asCommP } from '../commp/index.js'
import { PDPService } from './service.js'

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
 * Response from adding roots to a proof set
 */
export interface AddRootsResponse {
  /** Success message from the server */
  message: string
}

/**
 * Comprehensive proof set creation status combining PDP server and chain verification
 */
export interface ComprehensiveProofSetStatus {
  /** Status from PDP server (if available) */
  curioStatus?: ProofSetCreationStatusResponse
  /** Chain verification result */
  chainVerification: ProofSetCreationVerification
  /** Overall status assessment */
  overall: {
    /** Whether proof set creation is complete and verified */
    isComplete: boolean
    /** Whether there are any issues detected */
    hasIssues: boolean
    /** Human-readable status summary */
    summary: string
    /** Recommended next action */
    nextAction?: string
  }
}

// Note: We use RootData from types.ts for the public API
// The subroot structure is internal implementation detail

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
   * Get comprehensive proof set creation status combining PDP server and chain verification
   * This provides the most complete picture of proof set creation status
   * @param txHash - Transaction hash from createProofSet
   * @param pandoraAddress - Pandora contract address for chain verification
   * @param provider - Ethers provider for chain queries
   * @returns Promise that resolves with comprehensive status information
   */
  async getComprehensiveProofSetStatus (
    txHash: string,
    pandoraAddress: string,
    provider: ethers.Provider
  ): Promise<ComprehensiveProofSetStatus> {
    // Get chain verification first (this is most reliable)
    const pdpService = new PDPService(provider, pandoraAddress)
    const chainVerification = await pdpService.verifyProofSetCreation(txHash)

    // Try to get PDP server status (may fail if server is unavailable)
    let pdpServerStatus: ProofSetCreationStatusResponse | undefined
    try {
      pdpServerStatus = await this.getProofSetCreationStatus(txHash)
    } catch (error) {
      // PDP server status is optional - chain verification is primary
      console.warn('Could not get PDP server status:', error)
    }

    // Analyze overall status
    const overall = this._analyzeOverallStatus(chainVerification, pdpServerStatus)

    return {
      curioStatus: pdpServerStatus,
      chainVerification,
      overall
    }
  }

  /**
   * Wait for proof set creation to complete with comprehensive status updates
   * @param txHash - Transaction hash from createProofSet
   * @param pandoraAddress - Pandora contract address for chain verification
   * @param provider - Ethers provider for chain queries
   * @param onStatusUpdate - Callback for status updates during polling
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 5 minutes)
   * @param pollIntervalMs - How often to check in milliseconds (default: 3 seconds)
   * @returns Promise that resolves when proof set is confirmed
   */
  async waitForProofSetCreationWithStatus (
    txHash: string,
    pandoraAddress: string,
    provider: ethers.Provider,
    onStatusUpdate?: (status: ComprehensiveProofSetStatus) => void,
    timeoutMs: number = 300000,
    pollIntervalMs: number = 3000
  ): Promise<ComprehensiveProofSetStatus> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getComprehensiveProofSetStatus(txHash, pandoraAddress, provider)

      // Call status update callback if provided
      if (onStatusUpdate != null) {
        onStatusUpdate(status)
      }

      // Return if complete (either success or failure)
      if (status.overall.isComplete) {
        return status
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    // Timeout - get final status
    const finalStatus = await this.getComprehensiveProofSetStatus(txHash, pandoraAddress, provider)
    finalStatus.overall.summary += ' (Timeout reached)'
    finalStatus.overall.hasIssues = true

    return finalStatus
  }

  /**
   * Analyze overall status from chain and PDP server data
   */
  private _analyzeOverallStatus (
    chain: ProofSetCreationVerification,
    pdpServer?: ProofSetCreationStatusResponse
  ): ComprehensiveProofSetStatus['overall'] {
    // Transaction not yet mined
    if (!chain.transactionMined) {
      return {
        isComplete: false,
        hasIssues: false,
        summary: 'Transaction pending - waiting for confirmation on-chain',
        nextAction: 'Wait for transaction to be mined (this may take 30s-2min on Filecoin)'
      }
    }

    // Transaction failed
    if (chain.transactionMined && !chain.transactionSuccess) {
      return {
        isComplete: true,
        hasIssues: true,
        summary: `Transaction failed: ${chain.error ?? 'Unknown error'}`,
        nextAction: 'Check transaction details and retry proof set creation'
      }
    }

    // Transaction succeeded but no proof set ID found
    if (chain.transactionSuccess && chain.proofSetId == null) {
      return {
        isComplete: true,
        hasIssues: true,
        summary: `Transaction succeeded but no proof set was created: ${chain.error ?? 'ProofSetCreated event not found'}`,
        nextAction: 'Check transaction logs or contact support'
      }
    }

    // Transaction succeeded, proof set created, but not live
    if (chain.transactionSuccess && chain.proofSetId != null && !chain.proofSetLive) {
      return {
        isComplete: false,
        hasIssues: true,
        summary: `Proof set ${chain.proofSetId} was created but is not live on-chain`,
        nextAction: 'Wait a few more seconds or check proof set status manually'
      }
    }

    // Full success!
    if (chain.transactionSuccess && chain.proofSetId != null && chain.proofSetLive) {
      const blockInfo = chain.blockNumber != null ? ` (block ${chain.blockNumber})` : ''
      return {
        isComplete: true,
        hasIssues: false,
        summary: `Proof set ${chain.proofSetId} successfully created and is live${blockInfo}`,
        nextAction: 'You can now add roots to this proof set'
      }
    }

    // Shouldn't reach here, but handle unknown state
    return {
      isComplete: false,
      hasIssues: true,
      summary: 'Unknown status - unable to determine proof set creation state',
      nextAction: 'Try checking status again or contact support'
    }
  }

  /**
   * Add roots to an existing proof set
   * @param proofSetId - The ID of the proof set to add roots to
   * @param clientDataSetId - The client's dataset ID used when creating the proof set
   * @param nextRootId - The ID to assign to the first root being added
   * @param rootDataArray - Array of root data containing CommP CIDs and raw sizes
   * @returns Promise that resolves when the roots are added (201 Created)
   * @throws Error if any CID is invalid
   *
   * @example
   * ```typescript
   * const rootData = [{
   *   cid: 'baga6ea4seaq...', // CommP CID
   *   rawSize: 1024 * 1024   // Size in bytes
   * }]
   * await pdpTool.addRoots(proofSetId, clientDataSetId, nextRootId, rootData)
   * ```
   */
  async addRoots (
    proofSetId: number,
    clientDataSetId: number,
    nextRootId: number,
    rootDataArray: RootData[]
  ): Promise<AddRootsResponse> {
    if (rootDataArray.length === 0) {
      throw new Error('At least one root must be provided')
    }

    // Validate all CommPs
    for (const rootData of rootDataArray) {
      const commP = asCommP(rootData.cid)
      if (commP == null) {
        throw new Error(`Invalid CommP: ${String(rootData.cid)}`)
      }
    }

    // Generate the EIP-712 signature for adding roots
    const authData = await this.pdpAuthHelper.signAddRoots(
      clientDataSetId,
      nextRootId,
      rootDataArray // Pass RootData[] directly to auth helper
    )

    // Prepare the extra data for the contract call
    // This needs to match what the Pandora contract expects for addRoots
    const extraData = this._encodeAddRootsExtraData({
      signature: authData.signature,
      metadata: '' // Always use empty metadata
    })

    // Prepare request body matching the Curio handler expectation
    // Each root has itself as its only subroot (internal implementation detail)
    const requestBody = {
      roots: rootDataArray.map(rootData => {
        // Convert to string for JSON serialization
        const cidString = typeof rootData.cid === 'string' ? rootData.cid : rootData.cid.toString()
        return {
          rootCid: cidString,
          subroots: [{
            subrootCid: cidString // Root is its own subroot
          }]
        }
      }),
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
    const responseText = await response.text()
    return {
      message: responseText !== '' ? responseText : `Roots added to proof set ID ${proofSetId} successfully`
    }
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
