import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import type { ToString } from 'multiformats'
import { type Account, type Address, type Chain, type Client, type Hex, isHex, type Transport } from 'viem'
import { asChain } from '../chains.ts'
import { CreateDataSetError, LocationHeaderError } from '../errors/index.ts'
import type {
  WaitForAddPiecesError,
  WaitForAddPiecesRejectedError,
  WaitForCreateDataSetError,
  WaitForCreateDataSetRejectedError,
} from '../errors/pdp.ts'
import type { PieceCID } from '../piece/piece.ts'
import { signCreateDataSetAndAddPieces } from '../typed-data/sign-create-dataset-add-pieces.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { datasetMetadataObjectToEntry, type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { waitForAddPieces } from './add-pieces.ts'
import { waitForCreateDataSet } from './create-dataset.ts'

export namespace createDataSetAndAddPiecesApiRequest {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The address of the record keeper. */
    recordKeeper: Address
    /** The extra data for the create data set and add pieces. */
    extraData: Hex
    /** The pieces to add. */
    pieces: PieceCID[]
  }
  export type OutputType = {
    /** The transaction hash. */
    txHash: Hex
    /** The status URL. */
    statusUrl: string
  }
  export type ErrorType = CreateDataSetError | LocationHeaderError | TimeoutError | NetworkError | AbortError
  export type RequestBody = {
    recordKeeper: Address
    extraData: Hex
    pieces: {
      pieceCid: ToString<PieceCID>
      subPieces: { subPieceCid: ToString<PieceCID> }[]
    }[]
  }
}

/**
 * Create a data set and add pieces to it on PDP API
 *
 * POST /pdp/data-sets/create-and-add
 *
 * @param options - {@link createDataSetAndAddPiecesApiRequest.OptionsType}
 * @returns Hash and status URL {@link createDataSetAndAddPiecesApiRequest.OutputType}
 * @throws Errors {@link createDataSetAndAddPiecesApiRequest.ErrorType}
 */
export async function createDataSetAndAddPiecesApiRequest(
  options: createDataSetAndAddPiecesApiRequest.OptionsType
): Promise<createDataSetAndAddPiecesApiRequest.OutputType> {
  // Send the create data set message to the PDP
  const response = await request.post(new URL(`pdp/data-sets/create-and-add`, options.serviceURL), {
    body: JSON.stringify({
      recordKeeper: options.recordKeeper,
      extraData: options.extraData,
      pieces: options.pieces.map((piece) => ({
        pieceCid: piece.toString(),
        subPieces: [{ subPieceCid: piece.toString() }],
      })),
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new CreateDataSetError(await response.error.response.text())
    }
    throw response.error
  }

  const location = response.result.headers.get('Location')
  const hash = location?.split('/').pop()
  if (!location || !hash || !isHex(hash)) {
    throw new LocationHeaderError(location)
  }

  return {
    txHash: hash,
    statusUrl: new URL(location, options.serviceURL).toString(),
  }
}

export type CreateDataSetAndAddPiecesOptions = {
  /** The service URL of the PDP API. */
  serviceURL: string
  /** The address that will receive payments (service provider). */
  payee: Address
  /** The pieces and metadata to add to the data set. */
  pieces: { pieceCid: PieceCID; metadata?: MetadataObject }[]
  /**
   * The address that will pay for the storage (client). If not provided, the default is the client address.
   *
   * If client is from a session key this should be set to the actual payer address
   */
  payer?: Address
  /** The metadata for the data set. */
  metadata?: MetadataObject
  /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
  clientDataSetId?: bigint
  /** Pre-built signed extraData. When provided, skips internal EIP-712 signing. */
  extraData?: Hex
  /** Whether the data set should use CDN. */
  cdn?: boolean
  /** The address of the record keeper to use for the signature. If not provided, the default is the Warm Storage contract address. */
  recordKeeper?: Address
}

export namespace createDataSetAndAddPieces {
  export type OptionsType = CreateDataSetAndAddPiecesOptions
  export type ReturnType = createDataSetAndAddPiecesApiRequest.OutputType
  export type ErrorType = createDataSetAndAddPiecesApiRequest.ErrorType | signCreateDataSetAndAddPieces.ErrorType
}

/**
 * Create a data set and add pieces to it
 *
 * @param client - The client to use to create the data set.
 * @param options - {@link CreateDataSetAndAddPiecesOptions}
 * @returns The response from the create data set on PDP API. {@link createDataSetAndAddPieces.ReturnType}
 * @throws Errors {@link createDataSetAndAddPieces.ErrorType}
 */
export async function createDataSetAndAddPieces(
  client: Client<Transport, Chain, Account>,
  options: CreateDataSetAndAddPiecesOptions
): Promise<createDataSetAndAddPieces.ReturnType> {
  const chain = asChain(client.chain)
  const extraData =
    options.extraData ??
    (await signCreateDataSetAndAddPieces(client, {
      clientDataSetId: options.clientDataSetId,
      payee: options.payee,
      payer: options.payer,
      metadata: datasetMetadataObjectToEntry(options.metadata, {
        cdn: options.cdn ?? false,
      }),
      pieces: options.pieces.map((piece) => ({
        pieceCid: piece.pieceCid,
        metadata: pieceMetadataObjectToEntry(piece.metadata),
      })),
    }))

  return createDataSetAndAddPiecesApiRequest({
    serviceURL: options.serviceURL,
    recordKeeper: options.recordKeeper ?? chain.contracts.fwss.address,
    extraData,
    pieces: options.pieces.map((piece) => piece.pieceCid),
  })
}

export namespace waitForCreateDataSetAddPieces {
  export type OptionsType = {
    /** The status URL to poll. */
    statusUrl: string
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The polling interval in milliseconds. Defaults to 4 seconds. */
    pollInterval?: number
  }
  export type ReturnType = {
    hash: string
    dataSetId: bigint
    piecesIds: bigint[]
  }
  export type ErrorType =
    | WaitForCreateDataSetError
    | WaitForCreateDataSetRejectedError
    | WaitForAddPiecesError
    | WaitForAddPiecesRejectedError
    | TimeoutError
    | NetworkError
    | AbortError
}

/**
 * Wait for the data set creation status.
 *
 * GET /pdp/data-sets/created({txHash})
 *
 * @param options - {@link waitForCreateDataSetAddPieces.OptionsType}
 * @returns Status {@link waitForCreateDataSetAddPieces.ReturnType}
 * @throws Errors {@link waitForCreateDataSetAddPieces.ErrorType}
 */
export async function waitForCreateDataSetAddPieces(
  options: waitForCreateDataSetAddPieces.OptionsType
): Promise<waitForCreateDataSetAddPieces.ReturnType> {
  const origin = new URL(options.statusUrl).origin
  const createdDataset = await waitForCreateDataSet({ statusUrl: options.statusUrl })
  const addedPieces = await waitForAddPieces({
    statusUrl: new URL(
      `/pdp/data-sets/${createdDataset.dataSetId}/pieces/added/${createdDataset.createMessageHash}`,
      origin
    ).toString(),
  })
  return {
    hash: createdDataset.createMessageHash,
    dataSetId: createdDataset.dataSetId,
    piecesIds: addedPieces.confirmedPieceIds,
  }
}
