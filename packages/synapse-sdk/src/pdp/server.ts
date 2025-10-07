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
 * const { pieceCid, size } = await pdpServer.uploadPiece(data)
 *
 * // Download a piece
 * const data = await pdpServer.downloadPiece(pieceCid, size)
 * ```
 */

import { ethers } from 'ethers'
import { asPieceCID, calculate as calculatePieceCID, downloadAndValidate } from '../piece/index.ts'
import type { DataSetData, MetadataEntry, PieceCID } from '../types.ts'
import { validateDataSetMetadata, validatePieceMetadata } from '../utils/metadata.ts'
import { constructFindPieceUrl, constructPieceUrl } from '../utils/piece.ts'
import type { PDPAuthHelper } from './auth.ts'
import {
  asDataSetData,
  validateDataSetCreationStatusResponse,
  validateFindPieceResponse,
  validatePieceAdditionStatusResponse,
  validatePieceDeleteResponse,
} from './validation.ts'

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
  pieceCid: PieceCID
  /** @deprecated Use pieceCid instead. This field is for backward compatibility and will be removed in a future version */
  piece_cid?: string
}

/**
 * Upload response containing piece information
 */
export interface UploadResponse {
  /** PieceCID CID of the uploaded piece */
  pieceCid: PieceCID
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

/**
 * Input for adding pieces to a data set
 */
export interface PDPAddPiecesInput {
  pieces: {
    pieceCid: string
    subPieces: {
      subPieceCid: string
    }[]
  }[]
  extraData: string
}

export class PDPServer {
  private readonly _serviceURL: string
  private readonly _authHelper: PDPAuthHelper | null

  /**
   * Create a new PDPServer instance
   * @param authHelper - PDPAuthHelper instance for signing operations
   * @param serviceURL - The PDP service URL (e.g., https://pdp.provider.com)
   */
  constructor(authHelper: PDPAuthHelper | null, serviceURL: string) {
    if (serviceURL.trim() === '') {
      throw new Error('PDP service URL is required')
    }
    // Remove trailing slash from URL
    this._serviceURL = serviceURL.replace(/\/$/, '')
    this._authHelper = authHelper
  }

  /**
   * Create a new data set on the PDP server
   * @param clientDataSetId - Unique ID for the client's dataset
   * @param payee - Address that will receive payments (service provider)
   * @param metadata - Metadata entries for the data set (key-value pairs)
   * @param recordKeeper - Address of the Warm Storage contract
   * @returns Promise that resolves with transaction hash and status URL
   */
  async createDataSet(
    clientDataSetId: number,
    payee: string,
    metadata: MetadataEntry[],
    recordKeeper: string
  ): Promise<CreateDataSetResponse> {
    // Validate metadata against contract limits
    validateDataSetMetadata(metadata)

    // Generate the EIP-712 signature for data set creation
    const authData = await this.getAuthHelper().signCreateDataSet(clientDataSetId, payee, metadata)

    // Prepare the extra data for the contract call
    // This needs to match the DataSetCreateData struct in Warm Storage contract
    const extraData = this._encodeDataSetCreateData({
      payer: await this.getAuthHelper().getSignerAddress(),
      metadata,
      signature: authData.signature,
    })

    // Prepare request body
    const requestBody = {
      recordKeeper,
      extraData: `0x${extraData}`,
    }

    // Make the POST request to create the data set
    const response = await fetch(`${this._serviceURL}/pdp/data-sets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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
      statusUrl: `${this._serviceURL}${location}`,
    }
  }

  /**
   * Add pieces to an existing data set
   * @param dataSetId - The ID of the data set to add pieces to
   * @param clientDataSetId - The client's dataset ID used when creating the data set
   * @param nextPieceId - The ID to assign to the first piece being added, this should be
   *   the next available ID on chain or the signature will fail to be validated
   * @param pieceDataArray - Array of piece data containing PieceCID CIDs and raw sizes
   * @param metadata - Optional metadata for each piece (array of arrays, one per piece)
   * @returns Promise that resolves when the pieces are added (201 Created)
   * @throws Error if any CID is invalid
   *
   * @example
   * ```typescript
   * const pieceData = ['bafkzcibcd...']
   * const metadata = [[{ key: 'snapshotDate', value: '20250711' }]]
   * await pdpTool.addPieces(dataSetId, clientDataSetId, nextPieceId, pieceData, metadata)
   * ```
   */
  async addPieces(
    dataSetId: number,
    clientDataSetId: number,
    nextPieceId: number,
    pieceDataArray: PieceCID[] | string[],
    metadata?: MetadataEntry[][]
  ): Promise<AddPiecesResponse> {
    if (pieceDataArray.length === 0) {
      throw new Error('At least one piece must be provided')
    }

    // Validate piece metadata against contract limits
    if (metadata != null) {
      for (let i = 0; i < metadata.length; i++) {
        if (metadata[i] != null && metadata[i].length > 0) {
          try {
            validatePieceMetadata(metadata[i])
          } catch (error: any) {
            throw new Error(`Piece ${i} metadata validation failed: ${error.message}`)
          }
        }
      }
    }

    // Validate all PieceCIDs
    for (const pieceData of pieceDataArray) {
      const pieceCid = asPieceCID(pieceData)
      if (pieceCid == null) {
        throw new Error(`Invalid PieceCID: ${String(pieceData)}`)
      }
    }

    // If no metadata provided, create empty arrays for each piece
    const finalMetadata = metadata ?? pieceDataArray.map(() => [])

    // Validate metadata length matches pieces
    if (finalMetadata.length !== pieceDataArray.length) {
      throw new Error(`Metadata length (${finalMetadata.length}) must match pieces length (${pieceDataArray.length})`)
    }

    // Generate the EIP-712 signature for adding pieces
    const authData = await this.getAuthHelper().signAddPieces(
      clientDataSetId,
      nextPieceId,
      pieceDataArray, // Pass PieceData[] directly to auth helper
      finalMetadata
    )

    // Prepare the extra data for the contract call
    // This needs to match what the Warm Storage contract expects for addPieces
    const extraData = this._encodeAddPiecesExtraData({
      signature: authData.signature,
      metadata: finalMetadata,
    })

    // Prepare request body matching the Curio handler expectation
    // Each piece has itself as its only subPiece (internal implementation detail)
    const requestBody: PDPAddPiecesInput = {
      pieces: pieceDataArray.map((pieceData) => {
        // Convert to string for JSON serialization
        const cidString = typeof pieceData === 'string' ? pieceData : pieceData.toString()
        return {
          pieceCid: cidString,
          subPieces: [
            {
              subPieceCid: cidString, // Piece is its own subpiece
            },
          ],
        }
      }),
      extraData: `0x${extraData}`,
    }

    // Make the POST request to add pieces to the data set
    const response = await fetch(`${this._serviceURL}/pdp/data-sets/${dataSetId}/pieces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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
          txHash = `0x${txHash}`
        }
        statusUrl = `${this._serviceURL}${location}`
      }
    }

    // Success - pieces have been added
    const responseText = await response.text()
    return {
      message: responseText !== '' ? responseText : `Pieces added to data set ID ${dataSetId} successfully`,
      txHash,
      statusUrl,
    }
  }

  /**
   * Check the status of a data set creation
   * @param txHash - Transaction hash from createDataSet
   * @returns Promise that resolves with the creation status
   */
  async getDataSetCreationStatus(txHash: string): Promise<DataSetCreationStatusResponse> {
    const response = await fetch(`${this._serviceURL}/pdp/data-sets/created/${txHash}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 404) {
      throw new Error(`Data set creation not found for transaction hash: ${txHash}`)
    }

    if (response.status !== 200) {
      const errorText = await response.text()
      throw new Error(
        `Failed to get data set creation status: ${response.status} ${response.statusText} - ${errorText}`
      )
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
  async getPieceAdditionStatus(dataSetId: number, txHash: string): Promise<PieceAdditionStatusResponse> {
    const response = await fetch(`${this._serviceURL}/pdp/data-sets/${dataSetId}/pieces/added/${txHash}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

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
   * Find a piece by PieceCID and size
   * @param pieceCid - The PieceCID CID (as string or PieceCID object)
   * @returns Piece information if found
   */
  async findPiece(pieceCid: string | PieceCID): Promise<FindPieceResponse> {
    const parsedPieceCid = asPieceCID(pieceCid)
    if (parsedPieceCid == null) {
      throw new Error(`Invalid PieceCID: ${String(pieceCid)}`)
    }

    const url = constructFindPieceUrl(this._serviceURL, parsedPieceCid)
    const response = await fetch(url, {
      method: 'GET',
      headers: {},
    })

    if (response.status === 404) {
      throw new Error(`Piece not found: ${parsedPieceCid.toString()}`)
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
   * @returns Upload response with PieceCID and size
   */
  async uploadPiece(data: Uint8Array | ArrayBuffer): Promise<UploadResponse> {
    // Convert ArrayBuffer to Uint8Array if needed
    const uint8Data = data instanceof ArrayBuffer ? new Uint8Array(data) : data

    // Calculate PieceCID
    performance.mark('synapse:calculatePieceCID-start')
    const pieceCid = calculatePieceCID(uint8Data)
    performance.mark('synapse:calculatePieceCID-end')
    performance.measure('synapse:calculatePieceCID', 'synapse:calculatePieceCID-start', 'synapse:calculatePieceCID-end')
    const size = uint8Data.length

    const requestBody = {
      pieceCid: pieceCid.toString(),
      // No notify URL needed
    }

    // Create upload session or check if piece exists
    performance.mark('synapse:POST.pdp.piece-start')
    const createResponse = await fetch(`${this._serviceURL}/pdp/piece`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
    performance.mark('synapse:POST.pdp.piece-end')
    performance.measure('synapse:POST.pdp.piece', 'synapse:POST.pdp.piece-start', 'synapse:POST.pdp.piece-end')

    if (createResponse.status === 200) {
      // Piece already exists on server
      return {
        pieceCid,
        size,
      }
    }

    if (createResponse.status !== 201) {
      const errorText = await createResponse.text()
      throw new Error(
        `Failed to create upload session: ${createResponse.status} ${createResponse.statusText} - ${errorText}`
      )
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
        'Content-Length': uint8Data.length.toString(),
        // No Authorization header needed
      },
      body: uint8Data,
    })
    performance.mark('synapse:PUT.pdp.piece.upload-end')
    performance.measure(
      'synapse:PUT.pdp.piece.upload',
      'synapse:PUT.pdp.piece.upload-start',
      'synapse:PUT.pdp.piece.upload-end'
    )

    if (uploadResponse.status !== 204) {
      const errorText = await uploadResponse.text()
      throw new Error(`Failed to upload piece: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`)
    }

    return {
      pieceCid,
      size,
    }
  }

  /**
   * Download a piece from a service provider
   * @param pieceCid - The PieceCID CID of the piece
   * @returns The downloaded data
   */
  async downloadPiece(pieceCid: string | PieceCID): Promise<Uint8Array> {
    const parsedPieceCid = asPieceCID(pieceCid)
    if (parsedPieceCid == null) {
      throw new Error(`Invalid PieceCID: ${String(pieceCid)}`)
    }

    // Use the retrieval endpoint configured at construction time
    const downloadUrl = constructPieceUrl(this._serviceURL, parsedPieceCid)

    const response = await fetch(downloadUrl)

    // Use the shared download and validation function
    return await downloadAndValidate(response, parsedPieceCid)
  }

  /**
   * Get data set details from the PDP server
   * @param dataSetId - The ID of the data set to fetch
   * @returns Promise that resolves with data set data
   */
  async getDataSet(dataSetId: number): Promise<DataSetData> {
    const response = await fetch(`${this._serviceURL}/pdp/data-sets/${dataSetId}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
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
      console.error('Invalid data set data response:', data)
      throw new Error('Invalid data set data response format')
    }
    return converted
  }

  /**
   * Delete a piece from a data set
   * @param dataSetId - The ID of dataset to delete
   * @param clientDataSetId - Client dataset ID of the dataset to delete
   * @param pieceID -  The ID of the piece to delete
   * @returns Promise for transaction hash of the delete operation
   */
  async deletePiece(dataSetId: number, clientDataSetId: number, pieceID: number): Promise<string> {
    const authData = await this.getAuthHelper().signSchedulePieceRemovals(clientDataSetId, [pieceID])
    const payload = {
      extraData: `0x${authData.signature}`,
    }

    const response = await fetch(`${this._serviceURL}/pdp/data-sets/${dataSetId}/pieces/${pieceID}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (response.status !== 200) {
      const errorText = await response.text()
      throw new Error(`Failed to delete piece: ${response.status} ${response.statusText} - ${errorText}`)
    }
    const data = await response.json()
    return validatePieceDeleteResponse(data).txHash
  }

  /**
   * Encode DataSetCreateData for extraData field
   * This matches the Solidity struct DataSetCreateData in Warm Storage contract
   */
  private _encodeDataSetCreateData(data: { payer: string; metadata: MetadataEntry[]; signature: string }): string {
    // Ensure signature has 0x prefix
    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`

    // ABI encode the struct as a tuple
    // DataSetCreateData struct:
    // - address payer
    // - string[] metadataKeys
    // - string[] metadataValues
    // - bytes signature
    const keys = data.metadata.map((item) => item.key)
    const values = data.metadata.map((item) => item.value)
    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(['address', 'string[]', 'string[]', 'bytes'], [data.payer, keys, values, signature])

    // Return hex string without 0x prefix (since we add it in the calling code)
    return encoded.slice(2)
  }

  /**
   * Encode AddPieces extraData for the addPieces operation
   * Based on the Curio handler, this should be (bytes signature, string metadata)
   */
  private _encodeAddPiecesExtraData(data: { signature: string; metadata: MetadataEntry[][] }): string {
    // Ensure signature has 0x prefix
    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`
    const keys = data.metadata.map((item) => item.map((item) => item.key))
    const values = data.metadata.map((item) => item.map((item) => item.value))

    // ABI encode as (bytes signature, metadataKeys, metadataValues])
    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(['bytes', 'string[][]', 'string[][]'], [signature, keys, values])

    // Return hex string without 0x prefix (since we add it in the calling code)
    return encoded.slice(2)
  }

  /**
   * Ping the service provider to check connectivity
   * @returns Promise that resolves if provider is reachable (200 response)
   * @throws Error if provider is not reachable or returns non-200 status
   */
  async ping(): Promise<void> {
    const response = await fetch(`${this._serviceURL}/pdp/ping`, {
      method: 'GET',
      headers: {},
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
  getServiceURL(): string {
    return this._serviceURL
  }

  getAuthHelper(): PDPAuthHelper {
    if (this._authHelper == null) {
      throw new Error('AuthHelper is not available for an operation that requires signing')
    }
    return this._authHelper
  }
}
