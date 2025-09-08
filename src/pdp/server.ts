
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

import type { PDPAuthHelper } from './auth.js'
import type { PieceCID } from '../types.js'
import type { DataSetData } from '../types.js'
import { PDPServerPdp0 } from './server-pdp0.js'
import { PDPServerPdp1 } from './server-pdp1.js'

// Shared response interfaces
export interface CreateDataSetResponse {
  txHash: string
  statusUrl: string
}

export interface DataSetCreationStatusResponse {
  createMessageHash: string
  dataSetCreated: boolean
  service: string
  txStatus: string
  ok: boolean | null
  dataSetId?: number
}

export interface AddPiecesResponse {
  message: string
  txHash?: string
  statusUrl?: string
}

export interface FindPieceResponse {
  pieceCid: PieceCID
  piece_cid?: string
}

export interface UploadResponse {
  pieceCid: PieceCID
  size: number
}

export interface PieceAdditionStatusResponse {
  txHash: string
  txStatus: string
  dataSetId: number
  pieceCount: number
  addMessageOk: boolean | null
  confirmedPieceIds?: number[]
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

    if (await (new PDPServerPdp1(this._authHelper, baseUrl)).isSupported(baseUrl)) {
      return new PDPServerPdp1(this._authHelper, baseUrl)
    }
    return new PDPServerPdp0(this._authHelper, baseUrl)
  }

  private async _impl(): Promise<Backend> {
    return await this._implPromise
  }

  async createDataSet(
    clientDataSetId: number,
    payee: string,
    withCDN: boolean,
    recordKeeper: string
  ): Promise<CreateDataSetResponse> {
    const impl = await this._impl()
    return await impl.createDataSet(clientDataSetId, payee, withCDN, recordKeeper)
  }

  async addPieces(
    dataSetId: number,
    clientDataSetId: number,
    nextPieceId: number,
    pieceDataArray: PieceCID[] | string[]
  ): Promise<AddPiecesResponse> {
    const impl = await this._impl()
    return await impl.addPieces(dataSetId, clientDataSetId, nextPieceId, pieceDataArray)
  }

  async getDataSetCreationStatus(txHash: string): Promise<DataSetCreationStatusResponse> {
    const impl = await this._impl()
    return await impl.getDataSetCreationStatus(txHash)
  }

  async getPieceAdditionStatus(dataSetId: number, txHash: string): Promise<PieceAdditionStatusResponse> {
    const impl = await this._impl()
    return await impl.getPieceAdditionStatus(dataSetId, txHash)
  }

  async findPiece(pieceCid: string | PieceCID): Promise<FindPieceResponse> {
    const impl = await this._impl()
    return await impl.findPiece(pieceCid)
  }

  async uploadPiece(data: Uint8Array | ArrayBuffer): Promise<UploadResponse> {
    const impl = await this._impl()
    return await impl.uploadPiece(data)
  }

  async downloadPiece(pieceCid: string | PieceCID): Promise<Uint8Array> {
    const impl = await this._impl()
    return await impl.downloadPiece(pieceCid)
  }

  async getDataSet(dataSetId: number): Promise<DataSetData> {
    const impl = await this._impl()
    return await impl.getDataSet(dataSetId)
  }

  async ping(): Promise<void> {
    const impl = await this._impl()
    await impl.ping()
  }

  getServiceURL(): string {
    return this._baseUrl
  }

  getAuthHelper(): PDPAuthHelper {
    if (this._authHelper == null) {
      throw new Error('AuthHelper is not available for an operation that requires signing')
    }
    return this._authHelper
  }
}


