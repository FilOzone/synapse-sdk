import type { Account, Address, Chain, Client, Transport } from 'viem'
import { asChain, getChain } from '../chains.ts'
import type { PieceCID } from '../piece/piece.ts'
import { signCreateDataSet } from '../typed-data/sign-create-dataset.ts'
import { signCreateDataSetAndAddPieces } from '../typed-data/sign-create-dataset-add-pieces.ts'
import { datasetMetadataObjectToEntry, type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import * as SP from './sp.ts'

export type CreateDataSetOptions = {
  /** Whether the data set should use CDN. */
  cdn: boolean
  /** The address that will receive payments (service provider). */
  payee: Address
  /**
   * The address that will pay for the storage (client). If not provided, the default is the client address.
   * If client is from a session key this should be set to the actual payer address
   */
  payer?: Address
  /** The service URL of the PDP API. */
  serviceURL: string
  /** The metadata for the data set. */
  metadata?: MetadataObject
  /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
  clientDataSetId?: bigint
  /** The address of the record keeper to use for the signature. If not provided, the default is the Warm Storage contract address. */
  recordKeeper?: Address
}

/**
 * Create a data set
 *
 * @param client - The client to use to create the data set.
 * @param options - {@link CreateDataSetOptions}
 * @returns The response from the create data set on PDP API.
 */
export async function createDataSet(client: Client<Transport, Chain, Account>, options: CreateDataSetOptions) {
  const chain = getChain(client.chain.id)

  // Sign and encode the create data set message
  const extraData = await signCreateDataSet(client, {
    clientDataSetId: options.clientDataSetId,
    payee: options.payee,
    payer: options.payer,
    metadata: datasetMetadataObjectToEntry(options.metadata, {
      cdn: options.cdn,
    }),
  })

  return SP.createDataSet({
    serviceURL: options.serviceURL,
    recordKeeper: options.recordKeeper ?? chain.contracts.fwss.address,
    extraData,
  })
}

export type CreateDataSetAndAddPiecesOptions = {
  /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
  clientDataSetId?: bigint
  /** The address of the record keeper to use for the signature. If not provided, the default is the Warm Storage contract address. */
  recordKeeper?: Address
  /**
   * The address that will pay for the storage (client). If not provided, the default is the client address.
   *
   * If client is from a session key this should be set to the actual payer address
   */
  payer?: Address
  /** The service URL of the PDP API. */
  serviceURL: string
  /** The address that will receive payments (service provider). */
  payee: Address
  /** Whether the data set should use CDN. */
  cdn: boolean
  /** The metadata for the data set. */
  metadata?: MetadataObject
  /** The pieces and metadata to add to the data set. */
  pieces: { pieceCid: PieceCID; metadata?: MetadataObject }[]
}

export namespace createDataSetAndAddPieces {
  export type OptionsType = CreateDataSetAndAddPiecesOptions
  export type ReturnType = SP.createDataSetAndAddPieces.OutputType
  export type ErrorType = SP.createDataSetAndAddPieces.ErrorType | asChain.ErrorType
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

  const { txHash, statusUrl } = await SP.createDataSetAndAddPieces({
    serviceURL: options.serviceURL,
    recordKeeper: options.recordKeeper ?? chain.contracts.fwss.address,
    extraData: await signCreateDataSetAndAddPieces(client, {
      clientDataSetId: options.clientDataSetId,
      payee: options.payee,
      payer: options.payer,
      metadata: datasetMetadataObjectToEntry(options.metadata, {
        cdn: options.cdn,
      }),
      pieces: options.pieces.map((piece) => ({
        pieceCid: piece.pieceCid,
        metadata: pieceMetadataObjectToEntry(piece.metadata),
      })),
    }),
    pieces: options.pieces.map((piece) => piece.pieceCid),
  })

  return {
    txHash,
    statusUrl,
  }
}
