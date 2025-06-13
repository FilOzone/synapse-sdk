/**
 * PDPServer - Consolidated interface for all PDP server (Curio) HTTP operations
 *
 * This combines functionality for:
 * - Proof set management (create, add roots, status checks)
 * - Piece uploads
 * - Piece downloads
 * - Piece discovery
 *
 * @example
 * ```typescript
 * import { PDPServer } from '@filoz/synapse-sdk/pdp'
 * import { PDPAuthHelper } from '@filoz/synapse-sdk/pdp'
 *
 * const authHelper = new PDPAuthHelper(pandoraAddress, signer)
 * const pdpServer = new PDPServer(authHelper, 'https://pdp.provider.com', 'https://pdp.provider.com')
 *
 * // Create a proof set
 * const { txHash } = await pdpServer.createProofSet(storageProvider, clientDataSetId)
 *
 * // Upload a piece
 * const { commP, size } = await pdpServer.uploadPiece(data)
 *
 * // Download a piece
 * const data = await pdpServer.downloadPiece(commP, size)
 * ```
 */

import { ethers } from 'ethers'
import type { PDPAuthHelper } from './auth.js'
import type { RootData, CommP } from '../types.js'
import { asCommP, calculate as calculateCommP, downloadAndValidateCommP } from '../commp/index.js'
import { constructPieceUrl, constructFindPieceUrl } from '../utils/piece.js'
import { MULTIHASH_CODES } from '../utils/index.js'
import { toHex } from 'multiformats/bytes'

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
  /** The server's reported ID for this proof set (only available after creation) */
  proofSetId?: number
}

/**
 * Response from adding roots to a proof set
 */
export interface AddRootsResponse {
  /** Success message from the server */
  message: string
  /** Transaction hash for the root addition (optional - new servers only) */
  txHash?: string
  /** URL to check root addition status (optional - new servers only) */
  statusUrl?: string
}

/**
 * Response from finding a piece
 */
export interface FindPieceResponse {
  /** The piece CID that was found */
  piece_cid: string
}

/**
 * Upload response containing piece information
 */
export interface UploadResponse {
  /** CommP CID of the uploaded piece */
  commP: string
  /** Size of the uploaded piece in bytes */
  size: number
}

/**
 * Response from checking root addition status
 */
export interface RootAdditionStatusResponse {
  /** Transaction hash for the root addition */
  txHash: string
  /** Transaction status (pending, confirmed, failed) */
  txStatus: string
  /** The proof set ID */
  proofSetId: number
  /** Number of roots being added */
  rootCount: number
  /** Whether the add message was successful (null if pending) */
  addMessageOk: boolean | null
  /** Root IDs assigned after confirmation */
  confirmedRootIds?: number[]
}

export class PDPServer {
  private readonly _apiEndpoint: string
  private readonly _retrievalEndpoint: string
  private readonly _authHelper: PDPAuthHelper
  private readonly _serviceName: string

  /**
   * Create a new PDPServer instance
   * @param authHelper - PDPAuthHelper instance for signing operations
   * @param apiEndpoint - The PDP server HTTP endpoint (e.g., https://pdp.provider.com)
   * @param retrievalEndpoint - The piece retrieval endpoint (e.g., https://pdp.provider.com)
   * @param serviceName - Service name for uploads (defaults to 'public')
   */
  constructor (
    authHelper: PDPAuthHelper,
    apiEndpoint: string,
    retrievalEndpoint: string,
    serviceName: string = 'public'
  ) {
    if (apiEndpoint.trim() === '') {
      throw new Error('PDP API endpoint is required')
    }
    if (retrievalEndpoint.trim() === '') {
      throw new Error('PDP retrieval endpoint is required')
    }
    // Remove trailing slash from endpoints
    this._apiEndpoint = apiEndpoint.replace(/\/$/, '')
    this._retrievalEndpoint = retrievalEndpoint.replace(/\/$/, '')
    this._authHelper = authHelper
    this._serviceName = serviceName
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
    const authData = await this._authHelper.signCreateProofSet(clientDataSetId, payee, withCDN)

    // Prepare the extra data for the contract call
    // This needs to match the ProofSetCreateData struct in Pandora contract
    const extraData = this._encodeProofSetCreateData({
      metadata: '', // Empty metadata for now
      payer: await this._authHelper.getSignerAddress(),
      withCDN,
      signature: authData.signature
    })

    // Prepare request body
    const requestBody = {
      recordKeeper,
      extraData: `0x${extraData}`
    }

    // Make the POST request to create the proof set
    const response = await fetch(`${this._apiEndpoint}/pdp/proof-sets`, {
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
      statusUrl: `${this._apiEndpoint}${location}`
    }
  }

  /**
   * Add roots to an existing proof set
   * @param proofSetId - The ID of the proof set to add roots to
   * @param clientDataSetId - The client's dataset ID used when creating the proof set
   * @param nextRootId - The ID to assign to the first root being added, this should be
   *   the next available ID on chain or the signature will fail to be validated
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
    const authData = await this._authHelper.signAddRoots(
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
    const response = await fetch(`${this._apiEndpoint}/pdp/proof-sets/${proofSetId}/roots`, {
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

    // Check for Location header (backward compatible with old servers)
    const location = response.headers.get('Location')
    let txHash: string | undefined
    let statusUrl: string | undefined

    if (location != null) {
      // Expected format: /pdp/proof-sets/{proofSetId}/roots/added/{txHash}
      const locationMatch = location.match(/\/roots\/added\/([0-9a-fA-Fx]+)$/)
      if (locationMatch != null) {
        txHash = locationMatch[1]
        // Ensure txHash has 0x prefix
        if (!txHash.startsWith('0x')) {
          txHash = '0x' + txHash
        }
        statusUrl = `${this._apiEndpoint}${location}`
      }
    }

    // Success - roots have been added
    const responseText = await response.text()
    return {
      message: responseText !== '' ? responseText : `Roots added to proof set ID ${proofSetId} successfully`,
      txHash,
      statusUrl
    }
  }

  /**
   * Check the status of a proof set creation
   * @param txHash - Transaction hash from createProofSet
   * @returns Promise that resolves with the creation status
   */
  async getProofSetCreationStatus (txHash: string): Promise<ProofSetCreationStatusResponse> {
    const response = await fetch(`${this._apiEndpoint}/pdp/proof-sets/created/${txHash}`, {
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
   * Check the status of a root addition transaction
   * @param proofSetId - The proof set ID
   * @param txHash - Transaction hash from addRoots
   * @returns Promise that resolves with the addition status
   */
  async getRootAdditionStatus (
    proofSetId: number,
    txHash: string
  ): Promise<RootAdditionStatusResponse> {
    const response = await fetch(
      `${this._apiEndpoint}/pdp/proof-sets/${proofSetId}/roots/added/${txHash}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )

    if (response.status === 404) {
      throw new Error(`Root addition not found for transaction: ${txHash}`)
    }

    if (response.status !== 200) {
      const errorText = await response.text()
      throw new Error(`Failed to get root addition status: ${response.status} ${response.statusText} - ${errorText}`)
    }

    return await response.json() as RootAdditionStatusResponse
  }

  /**
   * Find a piece by CommP and size
   * @param commP - The CommP CID (as string or CommP object)
   * @param size - The original size of the piece in bytes
   * @returns Piece information if found
   */
  async findPiece (commP: string | CommP, size: number): Promise<FindPieceResponse> {
    const parsedCommP = asCommP(commP)
    if (parsedCommP == null) {
      throw new Error(`Invalid CommP: ${String(commP)}`)
    }

    const url = constructFindPieceUrl(this._apiEndpoint, parsedCommP, size)
    const response = await fetch(url, {
      method: 'GET',
      headers: {}
    })

    if (response.status === 404) {
      throw new Error(`Piece not found: ${parsedCommP.toString()}`)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to find piece: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const result = await response.json() as FindPieceResponse
    return result
  }

  /**
   * Upload a piece to the PDP server
   * @param data - The data to upload
   * @returns Upload response with CommP and size
   */
  async uploadPiece (data: Uint8Array | ArrayBuffer): Promise<UploadResponse> {
    // Convert ArrayBuffer to Uint8Array if needed
    const uint8Data = data instanceof ArrayBuffer ? new Uint8Array(data) : data

    // Calculate CommP
    const commP = await calculateCommP(uint8Data)
    const size = uint8Data.length

    // Extract the raw hash from the CommP CID
    const hashBytes = commP.multihash.digest
    const hashHex = toHex(hashBytes)

    // Create the check data as per original protocol
    const checkData = {
      name: MULTIHASH_CODES.SHA2_256_TRUNC254_PADDED,
      hash: hashHex,
      size
    }

    const requestBody = {
      check: checkData
      // No notify URL needed
    }

    // Create upload session or check if piece exists
    const createResponse = await fetch(`${this._apiEndpoint}/pdp/piece`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (createResponse.status === 200) {
      // Piece already exists on server
      return {
        commP: commP.toString(),
        size
      }
    }

    if (createResponse.status !== 201) {
      const errorText = await createResponse.text()
      throw new Error(`Failed to create upload session: ${createResponse.status} ${createResponse.statusText} - ${errorText}`)
    }

    // Extract upload ID from Location header
    const location = createResponse.headers.get('Location')
    if (location == null) {
      throw new Error('Server did not provide Location header in response (may be restricted by CORS policy)')
    }

    // Validate the location format and extract UUID
    // Match /pdp/piece/upload/UUID or /piece/upload/UUID anywhere in the path
    const locationMatch = location.match(/\/(?:pdp\/)?piece\/upload\/([a-fA-F0-9-]+)/)
    if (locationMatch == null) {
      throw new Error(`Invalid Location header format: ${location}`)
    }

    const uploadUuid = locationMatch[1] // Extract just the UUID

    // Upload the data
    const uploadResponse = await fetch(`${this._apiEndpoint}/pdp/piece/upload/${uploadUuid}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': uint8Data.length.toString()
        // No Authorization header needed
      },
      body: uint8Data
    })

    if (uploadResponse.status !== 204) {
      const errorText = await uploadResponse.text()
      throw new Error(`Failed to upload piece: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`)
    }

    return {
      commP: commP.toString(),
      size
    }
  }

  /**
   * Download a piece from a storage provider
   * @param commP - The CommP CID of the piece
   * @returns The downloaded data
   */
  async downloadPiece (
    commP: string | CommP
  ): Promise<Uint8Array> {
    const parsedCommP = asCommP(commP)
    if (parsedCommP == null) {
      throw new Error(`Invalid CommP: ${String(commP)}`)
    }

    // Use the retrieval endpoint configured at construction time
    const downloadUrl = constructPieceUrl(this._retrievalEndpoint, parsedCommP)

    const response = await fetch(downloadUrl)

    // Use the shared download and validation function
    return await downloadAndValidateCommP(response, parsedCommP)
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
    // Ensure signature has 0x prefix
    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`

    // ABI encode the struct as a tuple
    // ProofSetCreateData struct:
    // - string metadata
    // - address payer
    // - bool withCDN
    // - bytes signature
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

  getApiEndpoint (): string {
    return this._apiEndpoint
  }

  getAuthHelper (): PDPAuthHelper {
    return this._authHelper
  }
}
