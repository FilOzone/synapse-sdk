/**
 * PDPServer - Consolidated interface for all PDP server (Curio) HTTP operations
 *
 * This combines functionality for:
 * - Data set management (create, add pieces, status checks)
 * - Piece uploads
 * - Piece downloads
 * - Piece discovery
 *
 * @example
 * ```typescript
 * import { PDPServer } from '@filoz/synapse-sdk/pdp'
 * import { PDPAuthHelper } from '@filoz/synapse-sdk/pdp'
 *
 * const authHelper = new PDPAuthHelper(warmStorageAddress, signer)
 * const pdpServer = new PDPServer(authHelper, 'https://pdp.provider.com')
 *
 * // Create a data set
 * const { txHash } = await pdpServer.createDataSet(serviceProvider, clientDataSetId)
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
import type { PieceData, CommP, DataSetData } from '../types.js'
import { asCommP, calculate as calculateCommP, downloadAndValidateCommP } from '../commp/index.js'
import { constructPieceUrl, constructFindPieceUrl } from '../utils/piece.js'
import { MULTIHASH_CODES } from '../utils/index.js'
import { toHex } from 'multiformats/bytes'
import { validateDataSetCreationStatusResponse, validatePieceAdditionStatusResponse, validateFindPieceResponse, asDataSetData } from './validation.js'

/**
 * Response from creating a data set
 */
export interface CreateDataSetResponse {
  /** Transaction hash for the data set creation */
  txHash: string
  /** URL to check creation status */
  statusUrl: string
}

/**
 * Response from checking data set creation status
 */
export interface DataSetCreationStatusResponse {
  /** Transaction hash that created the data set */
  createMessageHash: string
  /** Whether the data set has been created on-chain */
  dataSetCreated: boolean
  /** Service label that created the data set */
  service: string
  /** Transaction status (pending, confirmed, failed) */
  txStatus: string
  /** Whether the transaction was successful (null if still pending) */
  ok: boolean | null
  /** The server's reported ID for this data set (only available after creation) */
  dataSetId?: number
}

/**
 * Response from adding pieces to a data set
 */
export interface AddPiecesResponse {
  /** Success message from the server */
  message: string
  /** Transaction hash for the piece addition (optional - new servers only) */
  txHash?: string
  /** URL to check piece addition status (optional - new servers only) */
  statusUrl?: string
}

/**
 * Response from finding a piece
 */
export interface FindPieceResponse {
  /** The piece CID that was found */
  pieceCid: CommP
  /** @deprecated Use pieceCid instead. This field is for backward compatibility and will be removed in a future version */
  piece_cid?: string
}

/**
 * Upload response containing piece information
 */
export interface UploadResponse {
  /** CommP CID of the uploaded piece */
  commP: CommP
  /** Size of the uploaded piece in bytes */
  size: number
}

/**
 * Response from checking piece addition status
 */
export interface PieceAdditionStatusResponse {
  /** Transaction hash for the piece addition */
  txHash: string
  /** Transaction status (pending, confirmed, failed) */
  txStatus: string
  /** The data set ID */
  dataSetId: number
  /** Number of pieces being added */
  pieceCount: number
  /** Whether the add message was successful (null if pending) */
  addMessageOk: boolean | null
  /** Piece IDs assigned after confirmation */
  confirmedPieceIds?: number[]
}

export class PDPServer {
  private readonly _serviceURL: string
  private readonly _authHelper: PDPAuthHelper | null
  private readonly _serviceName: string

  /**
   * Create a new PDPServer instance
   * @param authHelper - PDPAuthHelper instance for signing operations
   * @param serviceURL - The PDP service URL (e.g., https://pdp.provider.com)
   * @param serviceName - Service name for uploads (defaults to 'public')
   */
  constructor (
    authHelper: PDPAuthHelper | null,
    serviceURL: string,
    serviceName: string = 'public'
  ) {
    if (serviceURL.trim() === '') {
      throw new Error('PDP service URL is required')
    }
    // Remove trailing slash from URL
    this._serviceURL = serviceURL.replace(/\/$/, '')
    this._authHelper = authHelper
    this._serviceName = serviceName
  }

  /**
   * Create a new data set on the PDP server
   * @param clientDataSetId - Unique ID for the client's dataset
   * @param payee - Address that will receive payments (service provider)
   * @param withCDN - Whether to enable CDN services
   * @param recordKeeper - Address of the Warm Storage contract
   * @returns Promise that resolves with transaction hash and status URL
   */
  async createDataSet (
    clientDataSetId: number,
    payee: string,
    withCDN: boolean,
    recordKeeper: string
  ): Promise<CreateDataSetResponse> {
    // Generate the EIP-712 signature for data set creation
    const authData = await this.getAuthHelper().signCreateDataSet(clientDataSetId, payee, withCDN)

    // Prepare the extra data for the contract call
    // This needs to match the DataSetCreateData struct in Warm Storage contract
    const extraData = this._encodeDataSetCreateData({
      metadata: '', // Empty metadata for now
      payer: await this.getAuthHelper().getSignerAddress(),
      withCDN,
      signature: authData.signature
    })

    // Prepare request body
    const requestBody = {
      recordKeeper,
      extraData: `0x${extraData}`
    }

    // Make the POST request to create the data set
    const response = await fetch(`${this._serviceURL}/pdp/data-sets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (response.status !== 201) {
      const errorText = await response.text()
      throw new Error(`Failed to create data set: ${response.status} ${response.statusText} - ${errorText}`)
    }

    // Extract transaction hash from Location header
    const location = response.headers.get('Location')
    if (location == null) {
      throw new Error('Server did not provide Location header in response')
    }

    // Parse the location to extract the transaction hash
    // Expected format: /pdp/data-sets/created/{txHash}
    const locationMatch = location.match(/\/pdp\/data-sets\/created\/(.+)$/)
    if (locationMatch == null) {
      throw new Error(`Invalid Location header format: ${location}`)
    }

    const txHash = locationMatch[1]

    return {
      txHash,
      statusUrl: `${this._serviceURL}${location}`
    }
  }

  /**
   * Add pieces to an existing data set
   * @param dataSetId - The ID of the data set to add pieces to
   * @param clientDataSetId - The client's dataset ID used when creating the data set
   * @param nextPieceId - The ID to assign to the first piece being added, this should be
   *   the next available ID on chain or the signature will fail to be validated
   * @param pieceDataArray - Array of piece data containing CommP CIDs and raw sizes
   * @returns Promise that resolves when the pieces are added (201 Created)
   * @throws Error if any CID is invalid
   *
   * @example
   * ```typescript
   * const pieceData = [{
   *   cid: 'baga6ea4seaq...', // CommP CID
   *   rawSize: 1024 * 1024   // Size in bytes
   * }]
   * await pdpTool.addPieces(dataSetId, clientDataSetId, nextPieceId, pieceData)
   * ```
   */
  async addPieces (
    dataSetId: number,
    clientDataSetId: number,
    nextPieceId: number,
    pieceDataArray: PieceData[]
  ): Promise<AddPiecesResponse> {
    if (pieceDataArray.length === 0) {
      throw new Error('At least one piece must be provided')
    }

    // Validate all CommPs and raw sizes
    for (const pieceData of pieceDataArray) {
      const commP = asCommP(pieceData.cid)
      if (commP == null) {
        throw new Error(`Invalid CommP: ${String(pieceData.cid)}`)
      }

      // Validate raw size - must be positive
      if (pieceData.rawSize < 0) {
        throw new Error(`Invalid piece size: ${pieceData.rawSize}. Size must be a positive number`)
      }
    }

    // Generate the EIP-712 signature for adding pieces
    const authData = await this.getAuthHelper().signAddPieces(
      clientDataSetId,
      nextPieceId,
      pieceDataArray // Pass PieceData[] directly to auth helper
    )

    // Prepare the extra data for the contract call
    // This needs to match what the Warm Storage contract expects for addPieces
    const extraData = this._encodeAddPiecesExtraData({
      signature: authData.signature,
      metadata: '' // Always use empty metadata
    })

    // Prepare request body matching the Curio handler expectation
    // Each piece has itself as its only subPiece (internal implementation detail)
    const requestBody = {
      pieces: pieceDataArray.map(pieceData => {
        // Convert to string for JSON serialization
        const cidString = typeof pieceData.cid === 'string' ? pieceData.cid : pieceData.cid.toString()
        return {
          pieceCid: cidString,
          subPieces: [{
            subPieceCid: cidString // Piece is its own subpiece
          }]
        }
      }),
      extraData: `0x${extraData}`
    }

    // Make the POST request to add pieces to the data set
    const response = await fetch(`${this._serviceURL}/pdp/data-sets/${dataSetId}/pieces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (response.status !== 201) {
      const errorText = await response.text()
      throw new Error(`Failed to add pieces to data set: ${response.status} ${response.statusText} - ${errorText}`)
    }

    // Check for Location header (backward compatible with old servers)
    const location = response.headers.get('Location')
    let txHash: string | undefined
    let statusUrl: string | undefined

    if (location != null) {
      // Expected format: /pdp/data-sets/{dataSetId}/pieces/added/{txHash}
      const locationMatch = location.match(/\/pieces\/added\/([0-9a-fA-Fx]+)$/)
      if (locationMatch != null) {
        txHash = locationMatch[1]
        // Ensure txHash has 0x prefix
        if (!txHash.startsWith('0x')) {
          txHash = '0x' + txHash
        }
        statusUrl = `${this._serviceURL}${location}`
      }
    }

    // Success - pieces have been added
    const responseText = await response.text()
    return {
      message: responseText !== '' ? responseText : `Pieces added to data set ID ${dataSetId} successfully`,
      txHash,
      statusUrl
    }
  }

  /**
   * Check the status of a data set creation
   * @param txHash - Transaction hash from createDataSet
   * @returns Promise that resolves with the creation status
   */
  async getDataSetCreationStatus (txHash: string): Promise<DataSetCreationStatusResponse> {
    const response = await fetch(`${this._serviceURL}/pdp/data-sets/created/${txHash}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (response.status === 404) {
      throw new Error(`Data set creation not found for transaction hash: ${txHash}`)
    }

    if (response.status !== 200) {
      const errorText = await response.text()
      throw new Error(`Failed to get data set creation status: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    return validateDataSetCreationStatusResponse(data)
  }

  /**
   * Check the status of a piece addition transaction
   * @param dataSetId - The data set ID
   * @param txHash - Transaction hash from addPieces
   * @returns Promise that resolves with the addition status
   */
  async getPieceAdditionStatus (
    dataSetId: number,
    txHash: string
  ): Promise<PieceAdditionStatusResponse> {
    const response = await fetch(
      `${this._serviceURL}/pdp/data-sets/${dataSetId}/pieces/added/${txHash}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )

    if (response.status === 404) {
      throw new Error(`Piece addition not found for transaction: ${txHash}`)
    }

    if (response.status !== 200) {
      const errorText = await response.text()
      throw new Error(`Failed to get piece addition status: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    return validatePieceAdditionStatusResponse(data)
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

    const url = constructFindPieceUrl(this._serviceURL, parsedCommP, size)
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

    const data = await response.json()
    return validateFindPieceResponse(data)
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
    performance.mark('synapse:calculateCommP-start')
    const commP = await calculateCommP(uint8Data)
    performance.mark('synapse:calculateCommP-end')
    performance.measure('synapse:calculateCommP', 'synapse:calculateCommP-start', 'synapse:calculateCommP-end')
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
    performance.mark('synapse:POST.pdp.piece-start')
    const createResponse = await fetch(`${this._serviceURL}/pdp/piece`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })
    performance.mark('synapse:POST.pdp.piece-end')
    performance.measure('synapse:POST.pdp.piece', 'synapse:POST.pdp.piece-start', 'synapse:POST.pdp.piece-end')

    if (createResponse.status === 200) {
      // Piece already exists on server
      return {
        commP,
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
    performance.mark('synapse:PUT.pdp.piece.upload-start')
    const uploadResponse = await fetch(`${this._serviceURL}/pdp/piece/upload/${uploadUuid}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': uint8Data.length.toString()
        // No Authorization header needed
      },
      body: uint8Data
    })
    performance.mark('synapse:PUT.pdp.piece.upload-end')
    performance.measure('synapse:PUT.pdp.piece.upload', 'synapse:PUT.pdp.piece.upload-start', 'synapse:PUT.pdp.piece.upload-end')

    if (uploadResponse.status !== 204) {
      const errorText = await uploadResponse.text()
      throw new Error(`Failed to upload piece: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`)
    }

    return {
      commP,
      size
    }
  }

  /**
   * Download a piece from a service provider
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
    const downloadUrl = constructPieceUrl(this._serviceURL, parsedCommP)

    const response = await fetch(downloadUrl)

    // Use the shared download and validation function
    return await downloadAndValidateCommP(response, parsedCommP)
  }

  /**
   * Get data set details from the PDP server
   * @param dataSetId - The ID of the data set to fetch
   * @returns Promise that resolves with data set data
   */
  async getDataSet (dataSetId: number): Promise<DataSetData> {
    const response = await fetch(`${this._serviceURL}/pdp/data-sets/${dataSetId}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })

    if (response.status === 404) {
      throw new Error(`Data set not found: ${dataSetId}`)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch data set: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    const converted = asDataSetData(data)
    if (converted == null) {
      throw new Error('Invalid data set data response format')
    }
    return converted
  }

  /**
   * Encode DataSetCreateData for extraData field
   * This matches the Solidity struct DataSetCreateData in Warm Storage contract
   */
  private _encodeDataSetCreateData (data: {
    metadata: string
    payer: string
    withCDN: boolean
    signature: string
  }): string {
    // Ensure signature has 0x prefix
    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`

    // ABI encode the struct as a tuple
    // DataSetCreateData struct:
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
   * Encode AddPieces extraData for the addPieces operation
   * Based on the Curio handler, this should be (bytes signature, string metadata)
   */
  private _encodeAddPiecesExtraData (data: {
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

  /**
   * Ping the service provider to check connectivity
   * @returns Promise that resolves if provider is reachable (200 response)
   * @throws Error if provider is not reachable or returns non-200 status
   */
  async ping (): Promise<void> {
    const response = await fetch(`${this._serviceURL}/pdp/ping`, {
      method: 'GET',
      headers: {}
    })

    if (response.status !== 200) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`Provider ping failed: ${response.status} ${response.statusText} - ${errorText}`)
    }
  }

  /**
   * Get the service URL for this PDPServer instance
   * @returns The service URL
   */
  getServiceURL (): string {
    return this._serviceURL
  }

  getAuthHelper (): PDPAuthHelper {
    if (this._authHelper == null) {
      throw new Error('AuthHelper is not available for an operation that requires signing')
    }
    return this._authHelper
  }
}
