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

import * as Piece from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { ethers } from 'ethers'
import type { Hex } from 'viem'
import { asPieceCID, downloadAndValidate } from '../piece/index.ts'
import type { DataSetData, MetadataEntry, PieceCID } from '../types.ts'
import { validateDataSetMetadata, validatePieceMetadata } from '../utils/metadata.ts'
import { constructPieceUrl } from '../utils/piece.ts'
import type { PDPAuthHelper } from './auth.ts'
import {
  validateDataSetCreationStatusResponse,
  validatePieceAdditionStatusResponse,
  validatePieceStatusResponse,
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
}

/**
 * Response from checking piece indexing and IPNI status
 */
export interface PieceStatusResponse {
  /** The piece CID */
  pieceCid: string
  /** Current processing status */
  status: string
  /** Whether the piece has been indexed */
  indexed: boolean
  /** Whether the piece has been advertised to IPNI */
  advertised: boolean
  /**
   * Whether the piece has been retrieved
   * This does not necessarily mean it was retrieved by a particular indexer,
   * only that the PDP server witnessed a retrieval event. Care should be
   * taken when interpreting this field.
   */
  retrieved: boolean
  /** Timestamp when the piece was retrieved (optional) */
  retrievedAt?: string
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
  pieces: PDPPieces[]
  extraData: string
}

export interface PDPPieces {
  pieceCid: string
  subPieces: {
    subPieceCid: string
  }[]
}

export interface PDPCreateAndAddInput {
  recordKeeper: string
  pieces: PDPPieces[]
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
   * @param payer - Address that will pay for the storage (client)
   * @param metadata - Metadata entries for the data set (key-value pairs)
   * @param recordKeeper - Address of the Warm Storage contract
   * @returns Promise that resolves with transaction hash and status URL
   */
  async createDataSet(
    clientDataSetId: bigint,
    payee: string,
    payer: string,
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
      payer,
      clientDataSetId,
      metadata,
      signature: authData.signature,
    })

    return SP.createDataSet({
      endpoint: this._serviceURL,
      recordKeeper: recordKeeper as Hex,
      extraData: `0x${extraData}`,
    })
  }

  /**
   * Creates a data set and adds pieces to it in a combined operation.
   * Users can poll the status of the operation using the returned data set status URL.
   * After which the user can use the returned transaction hash and data set ID to check the status of the piece addition.
   * @param clientDataSetId  - Unique ID for the client's dataset
   * @param payee - Address that will receive payments (service provider)
   * @param payer - Address that will pay for the storage (client)
   * @param recordKeeper - Address of the Warm Storage contract
   * @param pieceDataArray - Array of piece data containing PieceCID CIDs and raw sizes
   * @param metadata - Optional metadata for dataset and each of the pieces.
   * @returns Promise that resolves with transaction hash and status URL
   */
  async createAndAddPieces(
    clientDataSetId: bigint,
    payee: string,
    payer: string,
    recordKeeper: string,
    pieceDataArray: PieceCID[] | string[],
    metadata: {
      dataset?: MetadataEntry[]
      pieces?: MetadataEntry[][]
    }
  ): Promise<CreateDataSetResponse> {
    // Validate metadata against contract limits
    if (metadata.dataset == null) {
      metadata.dataset = []
    }
    validateDataSetMetadata(metadata.dataset)
    metadata.pieces = PDPServer._processAddPiecesInputs(pieceDataArray, metadata.pieces)

    // Generate the EIP-712 signature for data set creation
    const createAuthData = await this.getAuthHelper().signCreateDataSet(clientDataSetId, payee, metadata.dataset)

    // Prepare the extra data for the contract call
    // This needs to match the DataSetCreateData struct in Warm Storage contract
    const createExtraData = this._encodeDataSetCreateData({
      payer,
      clientDataSetId,
      metadata: metadata.dataset,
      signature: createAuthData.signature,
    })

    const addAuthData = await this.getAuthHelper().signAddPieces(
      clientDataSetId,
      BigInt(0),
      pieceDataArray, // Pass PieceData[] directly to auth helper
      metadata.pieces
    )

    const addExtraData = this._encodeAddPiecesExtraData({
      signature: addAuthData.signature,
      metadata: metadata.pieces,
    })

    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(['bytes', 'bytes'], [`0x${createExtraData}`, `0x${addExtraData}`])
    const requestJson: PDPCreateAndAddInput = {
      recordKeeper: recordKeeper,
      pieces: PDPServer._formatPieceDataArrayForCurio(pieceDataArray),
      extraData: `${encoded}`,
    }

    // Make the POST request to add pieces to the data set
    const response = await fetch(`${this._serviceURL}/pdp/data-sets/create-and-add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestJson),
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

  private static _processAddPiecesInputs(
    pieceDataArray: PieceCID[] | string[],
    metadata?: MetadataEntry[][]
  ): MetadataEntry[][] {
    if (pieceDataArray.length === 0) {
      throw new Error('At least one piece must be provided')
    }

    if (metadata != null) {
      if (metadata.length !== pieceDataArray.length) {
        throw new Error(`Metadata length (${metadata.length}) must match pieces length (${pieceDataArray.length})`)
      }
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
    return finalMetadata
  }

  private static _formatPieceDataArrayForCurio(pieceDataArray: PieceCID[] | string[]): PDPPieces[] {
    return pieceDataArray.map((pieceData) => {
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
    })
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
    clientDataSetId: bigint,
    nextPieceId: number,
    pieceDataArray: PieceCID[] | string[],
    metadata?: MetadataEntry[][]
  ): Promise<AddPiecesResponse> {
    const finalMetadata = PDPServer._processAddPiecesInputs(pieceDataArray, metadata)
    // Generate the EIP-712 signature for adding pieces
    const authData = await this.getAuthHelper().signAddPieces(
      clientDataSetId,
      BigInt(nextPieceId),
      pieceDataArray, // Pass PieceData[] directly to auth helper
      finalMetadata
    )

    // Prepare the extra data for the contract call
    // This needs to match what the Warm Storage contract expects for addPieces
    const extraData = this._encodeAddPiecesExtraData({
      signature: authData.signature,
      metadata: finalMetadata,
    })

    const { txHash, statusUrl } = await SP.addPieces({
      endpoint: this._serviceURL,
      dataSetId: BigInt(dataSetId),
      pieces: pieceDataArray.map(asPieceCID).filter((t) => t != null),
      extraData: `0x${extraData}`,
      nextPieceId: BigInt(nextPieceId),
    })
    return {
      message: `Pieces added to data set ID ${dataSetId} successfully`,
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

    const piece = await SP.findPiece({
      endpoint: this._serviceURL,
      pieceCid: parsedPieceCid,
    })
    return {
      pieceCid: piece,
    }
  }

  /**
   * Get indexing and IPNI status for a piece
   *
   * TODO: not used anywhere, remove?
   *
   * @param pieceCid - The PieceCID CID (as string or PieceCID object)
   * @returns Piece status information including indexing and IPNI advertisement status
   * @throws Error if piece not found or doesn't belong to service (404)
   */
  async getPieceStatus(pieceCid: string | PieceCID): Promise<PieceStatusResponse> {
    const parsedPieceCid = asPieceCID(pieceCid)
    if (parsedPieceCid == null) {
      throw new Error(`Invalid PieceCID: ${String(pieceCid)}`)
    }

    const response = await fetch(`${this._serviceURL}/pdp/piece/${parsedPieceCid.toString()}/status`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    })

    if (response.status === 404) {
      const errorText = await response.text()
      throw new Error(`Piece not found or does not belong to service: ${errorText}`)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to get piece status: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    return validatePieceStatusResponse(data)
  }

  /**
   * Upload a piece to the PDP server
   * @param data - The data to upload
   * @returns Upload response with PieceCID and size
   */
  async uploadPiece(data: Uint8Array | ArrayBuffer): Promise<UploadResponse> {
    // Convert ArrayBuffer to Uint8Array if needed
    const uint8Data = data instanceof ArrayBuffer ? new Uint8Array(data) : data

    return await SP.uploadPiece({
      endpoint: this._serviceURL,
      data: uint8Data,
    })
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
    const data = await SP.getDataSet({
      endpoint: this._serviceURL,
      dataSetId: BigInt(dataSetId),
    })

    return {
      id: data.id,
      pieces: data.pieces.map((piece) => {
        const pieceCid = Piece.parse(piece.pieceCid)
        return {
          pieceId: piece.pieceId,
          pieceCid: pieceCid,
          subPieceCid: pieceCid,
          subPieceOffset: piece.subPieceOffset,
        }
      }),
      nextChallengeEpoch: data.nextChallengeEpoch,
    }
  }

  /**
   * Delete a piece from a data set
   * @param dataSetId - The ID of dataset to delete
   * @param clientDataSetId - Client dataset ID of the dataset to delete
   * @param pieceID -  The ID of the piece to delete
   * @returns Promise for transaction hash of the delete operation
   */
  async deletePiece(dataSetId: number, clientDataSetId: bigint, pieceID: number): Promise<string> {
    const authData = await this.getAuthHelper().signSchedulePieceRemovals(clientDataSetId, [BigInt(pieceID)])

    const { txHash } = await SP.deletePiece({
      endpoint: this._serviceURL,
      dataSetId: BigInt(dataSetId),
      pieceId: BigInt(pieceID),
      extraData: ethers.AbiCoder.defaultAbiCoder().encode(['bytes'], [authData.signature]) as Hex,
    })
    return txHash
  }

  /**
   * Encode DataSetCreateData for extraData field
   * This matches the Solidity struct DataSetCreateData in Warm Storage contract
   */
  private _encodeDataSetCreateData(data: {
    payer: string
    clientDataSetId: bigint
    metadata: MetadataEntry[]
    signature: string
  }): string {
    // Ensure signature has 0x prefix
    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`

    // ABI encode the struct as a tuple
    // DataSetCreateData struct:
    // - address payer
    // - uint256 clientDataSetId
    // - string[] metadataKeys
    // - string[] metadataValues
    // - bytes signature
    const keys = data.metadata.map((item) => item.key)
    const values = data.metadata.map((item) => item.value)
    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = abiCoder.encode(
      ['address', 'uint256', 'string[]', 'string[]', 'bytes'],
      [data.payer, data.clientDataSetId, keys, values, signature]
    )

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
