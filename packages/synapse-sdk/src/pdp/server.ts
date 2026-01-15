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
import { type MetadataObject, SIZE_CONSTANTS, uint8ArrayToAsyncIterable } from '@filoz/synapse-core/utils'
import {
  addPieces,
  createDataSet,
  createDataSetAndAddPieces,
  type PieceInputWithMetadata,
} from '@filoz/synapse-core/warm-storage'
import type { Account, Address, Chain, Client, Transport } from 'viem'
import type { DataSetData, PieceCID } from '../types.ts'

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
 * Response from adding pieces to a data set
 */
export interface AddPiecesResponse {
  /** Success message from the server */
  message: string
  /** Transaction hash for the piece addition (optional - new servers only) */
  txHash: string
  /** URL to check piece addition status (optional - new servers only) */
  statusUrl: string
}

/**
 * Options for uploading a piece
 */
export interface UploadPieceOptions {
  /** Optional progress callback */
  onProgress?: (bytesUploaded: number) => void
  /** Optional pre-calculated PieceCID to skip CommP calculation (BYO PieceCID, it will be checked by the server) */
  pieceCid?: PieceCID
  /** Optional AbortSignal to cancel the upload */
  signal?: AbortSignal
}

export namespace PDPServer {
  export type OptionsType = {
    client: Client<Transport, Chain, Account>
    /** The PDP service URL (e.g., https://pdp.provider.com). */
    endpoint: string
  }
  export type ErrorType = Error
}

export class PDPServer {
  private readonly _client: Client<Transport, Chain, Account>
  private readonly _endpoint: string

  /**
   * Create a new PDPServer instance
   * @param options - {@link PDPServer.OptionsType}
   */
  constructor(options: PDPServer.OptionsType) {
    this._client = options.client
    this._endpoint = options.endpoint
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
    payee: Address,
    payer: Address,
    metadata: MetadataObject,
    recordKeeper: Address
  ): Promise<CreateDataSetResponse> {
    return createDataSet(this._client, {
      endpoint: this._endpoint,
      payee,
      payer,
      metadata,
      cdn: false, // synpase sdk adds this to the metadata
      recordKeeper,
      clientDataSetId,
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
   * @param pieces - Array of pieces to add to the data set. {@link PieceInputWithMetadata}
   * @param metadata - Optional metadata for dataset and each of the pieces.
   * @returns Promise that resolves with transaction hash and status URL
   */
  async createAndAddPieces(
    clientDataSetId: bigint,
    payee: Address,
    payer: Address,
    recordKeeper: Address,
    pieces: PieceInputWithMetadata[],
    metadata: MetadataObject
  ): Promise<CreateDataSetResponse> {
    return createDataSetAndAddPieces(this._client, {
      endpoint: this._endpoint,
      clientDataSetId,
      payee,
      payer,
      recordKeeper,
      cdn: false, // synpase sdk adds this to the metadata
      pieces,
      metadata,
    })
  }

  /**
   * Add pieces to an existing data set
   * @param dataSetId - The ID of the data set to add pieces to
   * @param clientDataSetId - The client's dataset ID used when creating the data set
   * @param pieces - Array of piece data containing PieceCID CIDs and raw sizes
   * @returns Promise that resolves when the pieces are added (201 Created)
   * @throws Error if any CID is invalid
   */
  async addPieces(
    dataSetId: bigint,
    clientDataSetId: bigint,
    pieces: PieceInputWithMetadata[]
  ): Promise<AddPiecesResponse> {
    const { txHash, statusUrl } = await addPieces(this._client, {
      endpoint: this._endpoint,
      dataSetId: BigInt(dataSetId),
      clientDataSetId,
      pieces,
    })
    return {
      message: `Pieces added to data set ID ${dataSetId} successfully`,
      txHash,
      statusUrl,
    }
  }

  /**
   * Upload a piece to the PDP server using the commp-last protocol.
   *
   * Accepts data as Uint8Array, AsyncIterable<Uint8Array>, or ReadableStream<Uint8Array>.
   * For optimal performance with non-trivial sizes, prefer streaming types (AsyncIterable or ReadableStream)
   * to avoid memory pressure and blocking behavior. See SIZE_CONSTANTS.MAX_UPLOAD_SIZE
   * documentation for detailed guidance.
   *
   * @param data - The data to upload (Uint8Array, AsyncIterable, or ReadableStream)
   * @param options - Optional upload options {@link UploadPieceOptions}
   */
  async uploadPiece(
    data: Uint8Array | AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
    options?: UploadPieceOptions
  ): Promise<SP.UploadPieceResponse> {
    if (data instanceof Uint8Array) {
      // Check hard limit
      if (data.length > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
        throw new Error(
          `Upload size ${data.length} exceeds maximum ${SIZE_CONSTANTS.MAX_UPLOAD_SIZE} bytes (1 GiB with fr32 expansion)`
        )
      }

      // Convert to async iterable with chunking
      const iterable = uint8ArrayToAsyncIterable(data)

      return SP.uploadPieceStreaming({
        endpoint: this._endpoint,
        data: iterable,
        size: data.length, // Known size for Content-Length
        onProgress: options?.onProgress,
        pieceCid: options?.pieceCid,
        signal: options?.signal,
      })
    } else {
      // AsyncIterable or ReadableStream path - no size limit check here (checked during streaming)
      return SP.uploadPieceStreaming({
        endpoint: this._endpoint,
        data,
        // size unknown for streams
        onProgress: options?.onProgress,
        pieceCid: options?.pieceCid,
        signal: options?.signal,
      })
    }
  }

  /**
   * Get data set details from the PDP server
   * @param dataSetId - The ID of the data set to fetch
   * @returns Promise that resolves with data set data
   */
  async getDataSet(dataSetId: bigint): Promise<DataSetData> {
    const data = await SP.getDataSet({
      endpoint: this._endpoint,
      dataSetId: BigInt(dataSetId),
    })

    return {
      id: BigInt(data.id),
      pieces: data.pieces.map((piece) => {
        const pieceCid = Piece.parse(piece.pieceCid)
        return {
          pieceId: BigInt(piece.pieceId),
          pieceCid: pieceCid,
          subPieceCid: pieceCid,
          subPieceOffset: piece.subPieceOffset,
        }
      }),
      nextChallengeEpoch: data.nextChallengeEpoch,
    }
  }
}
