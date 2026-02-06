import type { Account, Chain, Client, Transport } from 'viem'
import { AtLeastOnePieceRequiredError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import * as PDP from './sp.ts'

export namespace addPieces {
  export type PieceType = {
    pieceCid: PieceCID
    metadata?: MetadataObject
  }
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The ID of the data set. */
    dataSetId: bigint
    /** The ID of the client data set. */
    clientDataSetId: bigint
    /** The pieces to add. */
    pieces: PieceType[]
    /** The nonce to use for the add pieces signature. */
    nonce?: bigint
  }

  export type OutputType = PDP.addPieces.OutputType
  export type ErrorType = PDP.addPieces.ErrorType
}

/**
 * Add pieces to a data set
 *
 * Call the Service Provider API to add pieces to a data set.
 *
 * @param client - The client to use to add the pieces.
 * @param options - The options for the add pieces. {@link addPieces.OptionsType}
 * @returns The response from the add pieces operation. {@link addPieces.OutputType}
 * @throws Errors {@link addPieces.ErrorType}
 */
export async function addPieces(
  client: Client<Transport, Chain, Account>,
  options: addPieces.OptionsType
): Promise<addPieces.OutputType> {
  if (options.pieces.length === 0) {
    throw new AtLeastOnePieceRequiredError()
  }
  return PDP.addPieces({
    serviceURL: options.serviceURL,
    dataSetId: options.dataSetId,
    pieces: options.pieces.map((piece) => piece.pieceCid),
    extraData: await signAddPieces(client, {
      clientDataSetId: options.clientDataSetId,
      nonce: options.nonce,
      pieces: options.pieces.map((piece) => ({
        pieceCid: piece.pieceCid,
        metadata: pieceMetadataObjectToEntry(piece.metadata),
      })),
    }),
  })
}
