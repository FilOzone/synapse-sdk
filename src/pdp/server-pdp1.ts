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

import { CurioMarket, type Deal, type PDPV1, type Products, type DataSource, type RetrievalV1 } from '@curiostorage/market-client'
import { ulid } from 'ulid'
import { asPieceCID, calculate as calculatePieceCID, downloadAndValidate } from '../piece/index.js'
import type { DataSetData, PieceCID } from '../types.js'
import { constructFindPieceUrl, constructPieceUrl } from '../utils/piece.js'
import type { PDPAuthHelper } from './auth.js'
import type {
  AddPiecesResponse,
  CreateDataSetResponse,
  DataSetCreationStatusResponse,
  FindPieceResponse,
  PieceAdditionStatusResponse,
  UploadResponse,
} from './server.ts'
import { asDataSetData, validateFindPieceResponse } from './validation.js'

/**
 * Response from creating a data set
 */
// Types are imported from './server.js'

/**
 * Response from checking data set creation status
 */
//

/**
 * Response from adding pieces to a data set
 */
//

/**
 * Response from finding a piece
 */
//

/**
 * Upload response containing piece information
 */
//

/**
 * Response from checking piece addition status
 */
//
export class PDPServerPdp1 {
  private readonly _serviceURL: string
  private readonly _authHelper: PDPAuthHelper | null
  private _marketClient: InstanceType<typeof CurioMarket.MarketClient>
  private _recordKeeper: string | null = null
  private _contractAddress: string | null = null

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
    this._marketClient = new CurioMarket.MarketClient({ serverUrl: serviceURL })
  }

  async isSupported(_baseUrl: string): Promise<boolean> {
    try {
      const products = await this._marketClient.getProducts()
      return products != null && Object.keys(products).length > 0
    } catch (_error) {
      return false
    }
  }

  /**
   * Create a new data set on the PDP server
   * @param clientDataSetId - Unique ID for the client's dataset
   * @param payee - Address that will receive payments (service provider)
   * @param withCDN - Whether to enable CDN services
   * @param recordKeeper - Address of the Warm Storage contract
   * @returns Promise that resolves with transaction hash and status URL
   */
  async createDataSet(
    clientDataSetId: number,
    payee: string,
    withCDN: boolean,
    recordKeeper: string
  ): Promise<CreateDataSetResponse> {
    try {
      // Create metadata for CDN if requested
      const metadata = withCDN ? [this.getAuthHelper().WITH_CDN_METADATA] : []
      
      // Generate EIP-712 signature for dataset creation
      const authData = await this.getAuthHelper().signCreateDataSet(clientDataSetId, payee, metadata)
      
      // Create the deal payload for dataset creation using ULID
      const datasetId = ulid()
      const createDataSetDeal: Deal = {
        identifier: datasetId,
        client: await this.getAuthHelper().getSignerAddress(),
        products: {
          pdpV1: {
            createDataSet: true,
            addPiece: false,
            recordKeeper,
            extraData: [],
            deleteDataSet: false,
            deletePiece: false,
          } as PDPV1,
          retrievalV1: {
            announcePayload: false,
            announcePiece: withCDN,
            indexing: false,
          } as RetrievalV1,
        } as Products,
      }

      // Submit the dataset creation deal
      const dealId = await this._marketClient.submitDeal(createDataSetDeal)
      
      // Return the result in the expected format
      return {
        txHash: createDataSetDeal.identifier, // The ULID from the deal
        statusUrl: `${this._serviceURL}/pdp/data-sets/created/${createDataSetDeal.identifier}`,
      }
    } catch (error) {
      throw new Error(`Failed to create data set: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Add pieces to an existing data set
   * @param dataSetId - The ID of the data set to add pieces to
   * @param clientDataSetId - The client's dataset ID used when creating the data set
   * @param nextPieceId - The ID to assign to the first piece being added, this should be
   *   the next available ID on chain or the signature will fail to be validated
   * @param pieceDataArray - Array of piece data containing PieceCID CIDs and raw sizes
   * @returns Promise that resolves when the pieces are added (201 Created)
   * @throws Error if any CID is invalid
   *
   * @example
   * ```typescript
   * const pieceData = ['bafkzcibcd...']
   * await pdpTool.addPieces(dataSetId, clientDataSetId, nextPieceId, pieceData)
   * ```
   */
  async addPieces(
    dataSetId: number,
    clientDataSetId: number,
    nextPieceId: number,
    pieceDataArray: PieceCID[] | string[]
  ): Promise<AddPiecesResponse> {
    if (pieceDataArray.length === 0) {
      throw new Error('At least one piece must be provided')
    }

    try {
      // Validate all PieceCIDs and convert to strings
      const pieceCidStrings = pieceDataArray.map((pieceData) => {
        const pieceCid = asPieceCID(pieceData)
        if (pieceCid == null) {
          throw new Error(`Invalid PieceCID: ${String(pieceData)}`)
        }
        return pieceCid.toString()
      })

      // Generate EIP-712 signature for adding pieces
      const metadata: any[][] = [] // Empty metadata for each piece
      const authData = await this.getAuthHelper().signAddPieces(
        clientDataSetId,
        nextPieceId,
        pieceDataArray,
        metadata
      )

      // Create a new deal for adding pieces to the existing dataset
      // Each piece needs its own deal in PDP v1, but we can batch them efficiently
      const results = []
      
      for (let i = 0; i < pieceCidStrings.length; i++) {
        const pieceCid = pieceCidStrings[i]
        const pieceId = nextPieceId + i

        // Create the deal payload for adding this piece using ULID
        const uploadId = ulid()
        const addPieceDeal: Deal = {
          identifier: uploadId,
          client: await this.getAuthHelper().getSignerAddress(),
          data: {
            pieceCid: { "/": pieceCid } as object,
            format: { raw: {} },
            sourceHttpPut: {},
          } as DataSource,
          products: {
            pdpV1: {
              addPiece: true,
              dataSetId,
              recordKeeper: this._recordKeeper || '', // Use stored recordKeeper or empty string
              extraData: [],
              deleteDataSet: false,
              deletePiece: false,
            } as PDPV1,
            retrievalV1: {
              announcePayload: false,
              announcePiece: true,
              indexing: false,
            } as RetrievalV1,
          } as Products,
        }

        // Submit the add piece deal
        const dealId = await this._marketClient.submitDeal(addPieceDeal)
        results.push({
          pieceId,
          dealId,
          identifier: addPieceDeal.identifier,
        })
      }


      // Return the result for the first piece
      const firstResult = results[0]

      return {
        message: `Pieces added to data set ID ${dataSetId} successfully`,
        txHash: firstResult.identifier,
        statusUrl: `${this._serviceURL}/pdp/data-sets/${dataSetId}/pieces/added/${firstResult.identifier}`,
      }
    } catch (error) {
      throw new Error(`Failed to add pieces to data set: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Check the status of a data set creation
   * @param txHash - Transaction hash from createDataSet
   * @returns Promise that resolves with the creation status
   */
  async getDataSetCreationStatus(txHash: string): Promise<DataSetCreationStatusResponse> {
    try {
      // Use the MarketClient's getStatus method to check the deal status
      const status = await this._marketClient.getStatus(txHash)
      const pdp = status.pdpV1

      // Convert the MarketClient status response to our expected format
      return {
        createMessageHash: txHash,
        dataSetCreated: pdp?.status === 'complete',
        service: 'PDPv1',
        txStatus: pdp?.status || 'unknown',
        ok: pdp?.status === 'complete' ? true : pdp?.status === 'failed' ? false : null,
        dataSetId: pdp?.dataSetId,
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        throw new Error(`Data set creation not found for transaction hash: ${txHash}`)
      }
      throw new Error(
        `Failed to get data set creation status: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Check the status of a piece addition transaction
   * @param dataSetId - The data set ID
   * @param txHash - Transaction hash from addPieces
   * @returns Promise that resolves with the addition status
   */
  async getPieceAdditionStatus(dataSetId: number, txHash: string): Promise<PieceAdditionStatusResponse> {
    try {
      // Use the MarketClient's getStatus method to check the deal status
      const status = await this._marketClient.getStatus(txHash)
      const pdp = status.pdpV1

      // Convert the MarketClient status response to our expected format
      return {
        txHash,
        txStatus: pdp?.status || 'unknown',
        dataSetId,
        pieceCount: 1, // PDP v1 handles one piece per deal
        addMessageOk: pdp?.status === 'complete' ? true : pdp?.status === 'failed' ? false : null,
        confirmedPieceIds: pdp?.status === 'complete' ? [dataSetId] : undefined,
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        throw new Error(`Piece addition not found for transaction: ${txHash}`)
      }
      throw new Error(`Failed to get piece addition status: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Find a piece by PieceCID and size
   * @param pieceCid - The PieceCID CID (as string or PieceCID object)
   * @param size - The original size of the piece in bytes
   * @returns Piece information if found
   */
  async findPiece(pieceCid: string | PieceCID): Promise<FindPieceResponse> {
    const parsedPieceCid = asPieceCID(pieceCid)
    if (parsedPieceCid == null) {
      throw new Error(`Invalid PieceCID: ${String(pieceCid)}`)
    }

    try {
      // For PDP v1, we'll use the MarketClient's capabilities to find pieces
      // Since the MarketClient doesn't have a direct findPiece method, we'll use
      // the traditional HTTP endpoint but with the market client's base URL

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
    } catch (error) {
      throw new Error(`Failed to find piece: ${error instanceof Error ? error.message : String(error)}`)
    }
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

    try {
      // Convert Uint8Array to Blob for the MarketClient
      const blob = new Blob([uint8Data])

      // Get contract addresses
      const { recordKeeper, contractAddress } = this._getContractAddresses()

      // Use the MarketClient's startPDPv1DealForUpload method for complete upload
      const result = await this._marketClient.startPDPv1DealForUpload({
        blobs: [blob],
        client: await this.getAuthHelper().getSignerAddress(),
        recordKeeper,
        contractAddress,
      })

      // Upload the blobs using the returned upload ID
      const uploadResult = await this._marketClient.uploadBlobs({
        id: result.id,
        blobs: [blob],
        deal: undefined, // Use the deal from startPDPv1DealForUpload
        chunkSize: 16 * 1024 * 1024, // 16MB chunks as per example
      })

      return {
        pieceCid,
        size,
      }
    } catch (error) {
      throw new Error(`Failed to upload piece: ${error instanceof Error ? error.message : String(error)}`)
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

    try {
      // For PDP v1, we'll use the traditional download method
      // The MarketClient doesn't have a direct download method, so we'll use
      // the standard HTTP endpoint for piece retrieval

      const downloadUrl = constructPieceUrl(this._serviceURL, parsedPieceCid)
      const response = await fetch(downloadUrl)

      // Use the shared download and validation function
      return await downloadAndValidate(response, parsedPieceCid)
    } catch (error) {
      throw new Error(`Failed to download piece: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get data set details from the PDP server
   * @param dataSetId - The ID of the data set to fetch
   * @returns Promise that resolves with data set data
   */
  async getDataSet(dataSetId: number): Promise<DataSetData> {
    try {
      // For PDP v1, we'll use the traditional HTTP endpoint for getting dataset details
      // The MarketClient doesn't have a direct getDataSet method

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
    } catch (error) {
      throw new Error(`Failed to get data set: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Ping the service provider to check connectivity
   * @returns Promise that resolves if provider is reachable (200 response)
   * @throws Error if provider is not reachable or returns non-200 status
   */
  async ping(): Promise<void> {
    try {
      // For PDP v1, we'll use the MarketClient's getProducts method to test connectivity
      // This is more reliable than a simple ping endpoint

      await this._marketClient.getProducts()
    } catch (error) {
      const errorText = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Provider ping failed: ${errorText}`)
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

  /**
   * Set the record keeper and contract address for PDP v1 operations
   * @param recordKeeper - Address of the Warm Storage contract
   * @param contractAddress - Address of the PDP contract
   */
  setContractAddresses(recordKeeper: string, contractAddress: string): void {
    this._recordKeeper = recordKeeper
    this._contractAddress = contractAddress
  }

  private _getContractAddresses(): { recordKeeper: string; contractAddress: string } {
    if (this._recordKeeper == null || this._contractAddress == null) {
      throw new Error('Contract addresses not set. Call setContractAddresses() first.')
    }
    return {
      recordKeeper: this._recordKeeper,
      contractAddress: this._contractAddress,
    }
  }
}
