/**
 * PDPServer - Consolidated interface for all PDP server implementations

 * ```
 */

import type { DataSetData, PieceCID } from '../types.ts'
import type { PDPAuthHelper } from './auth.ts'
import type {
  AddPiecesResponse,
  CreateDataSetResponse,
  DataSetCreationStatusResponse,
  FindPieceResponse,
  PieceAdditionStatusResponse,
  UploadResponse,
} from './server.ts'
import { PDPServerPdp0 } from './server.ts'
import { PDPServerPdp1 } from './server-pdp1.ts'

// Re-export types from server.ts
export type {
  AddPiecesResponse,
  CreateDataSetResponse,
  DataSetCreationStatusResponse,
  FindPieceResponse,
  PieceAdditionStatusResponse,
  UploadResponse,
}

type Backend = PDPServerPdp0 | PDPServerPdp1

export class PDPServer {
  private readonly _implPromise: Promise<Backend>
  private readonly _baseUrl: string
  private readonly _authHelper: PDPAuthHelper | null

  constructor(authHelper: PDPAuthHelper | null, serviceURL: string) {
    this._baseUrl = serviceURL.replace(/\/$/, '')
    this._authHelper = authHelper
    this._implPromise = this._selectBackend()
  }

  private async _selectBackend(): Promise<Backend> {
    const baseUrl = this._baseUrl

    if (await new PDPServerPdp1(this._authHelper, baseUrl).isSupported(baseUrl)) {
      return new PDPServerPdp1(this._authHelper, baseUrl)
    }
    return new PDPServerPdp0(this._authHelper, baseUrl)
  }

  private async _impl(): Promise<Backend> {
    return await this._implPromise
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
    const impl = await this._impl()
    return await impl.createDataSet(clientDataSetId, payee, withCDN, recordKeeper)
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
    const impl = await this._impl()
    return await impl.addPieces(dataSetId, clientDataSetId, nextPieceId, pieceDataArray)
  }

  /**
   * Check the status of a data set creation
   * @param txHash - Transaction hash from createDataSet
   * @returns Promise that resolves with the creation status
   */
  async getDataSetCreationStatus(txHash: string): Promise<DataSetCreationStatusResponse> {
    const impl = await this._impl()
    return await impl.getDataSetCreationStatus(txHash)
  }

  /**
   * Check the status of a piece addition transaction
   * @param dataSetId - The data set ID
   * @param txHash - Transaction hash from addPieces
   * @returns Promise that resolves with the addition status
   */
  async getPieceAdditionStatus(dataSetId: number, txHash: string): Promise<PieceAdditionStatusResponse> {
    const impl = await this._impl()
    return await impl.getPieceAdditionStatus(dataSetId, txHash)
  }

  /**
   * Find a piece by PieceCID and size
   * @param pieceCid - The PieceCID CID (as string or PieceCID object)
   * @param size - The original size of the piece in bytes
   * @returns Piece information if found
   */
  async findPiece(pieceCid: string | PieceCID): Promise<FindPieceResponse> {
    const impl = await this._impl()
    return await impl.findPiece(pieceCid)
  }

  /**
   * Upload a piece to the PDP server
   * @param data - The data to upload
   * @returns Upload response with PieceCID and size
   */
  async uploadPiece(data: Uint8Array | ArrayBuffer): Promise<UploadResponse> {
    const impl = await this._impl()
    return await impl.uploadPiece(data)
  }

  /**
   * Download a piece from a service provider
   * @param pieceCid - The PieceCID CID of the piece
   * @returns The downloaded data
   */
  async downloadPiece(pieceCid: string | PieceCID): Promise<Uint8Array> {
    const impl = await this._impl()
    return await impl.downloadPiece(pieceCid)
  }

  /**
   * Get data set details from the PDP server
   * @param dataSetId - The ID of the data set to fetch
   * @returns Promise that resolves with data set data
   */
  async getDataSet(dataSetId: number): Promise<DataSetData> {
    const impl = await this._impl()
    return await impl.getDataSet(dataSetId)
  }

  /**
   * Ping the service provider to check connectivity
   * @returns Promise that resolves if provider is reachable (200 response)
   * @throws Error if provider is not reachable or returns non-200 status
   */
  async ping(): Promise<void> {
    const impl = await this._impl()
    if (impl instanceof PDPServerPdp1) {
      // The selection of the backend already acts as the ping.
      return new Promise((r) => r())
    }
    await impl.ping()
  }

  /**
   * Get the service URL for this PDPServer instance
   * @returns The service URL
   */
  getServiceURL(): string {
    return this._baseUrl
  }

  /**
   * Get the auth helper instance
   * @returns The PDPAuthHelper instance
   * @throws Error if auth helper is not available
   */
  getAuthHelper(): PDPAuthHelper {
    if (this._authHelper == null) {
      throw new Error('AuthHelper is not available for an operation that requires signing')
    }
    return this._authHelper
  }
}
