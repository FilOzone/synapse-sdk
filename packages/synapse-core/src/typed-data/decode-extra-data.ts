import { type Address, type DecodeAbiParametersErrorType, decodeAbiParameters, type Hex } from 'viem'
import { signAddPiecesAbiParameters } from './sign-add-pieces.ts'
import { signCreateDataSetAbiParameters } from './sign-create-dataset.ts'
import { signcreateDataSetAndAddPiecesAbiParameters } from './sign-create-dataset-add-pieces.ts'

export namespace decodeAddPiecesExtraData {
  export type OutputType = {
    /** The replay-protection nonce FWSS records once the pieces are added. */
    nonce: bigint
  }
  export type ErrorType = DecodeAbiParametersErrorType
}

/**
 * Decode the nonce from add pieces extra data.
 *
 * The piece count cannot be decoded: `signAddPieces` omits the per-piece metadata when no piece has any.
 *
 * @param extraData - Extra data from `signAddPieces`.
 * @returns The nonce {@link decodeAddPiecesExtraData.OutputType}
 * @throws Errors {@link decodeAddPiecesExtraData.ErrorType}
 */
export function decodeAddPiecesExtraData(extraData: Hex): decodeAddPiecesExtraData.OutputType {
  const [nonce] = decodeAbiParameters(signAddPiecesAbiParameters, extraData)
  return { nonce }
}

export namespace decodeCreateDataSetExtraData {
  export type OutputType = {
    /** The payer of the data set. */
    payer: Address
    /** The client data set ID, which FWSS also uses as the replay-protection nonce. */
    clientDataSetId: bigint
  }
  export type ErrorType = DecodeAbiParametersErrorType
}

/**
 * Decode the payer and client data set ID from create data set extra data.
 *
 * @param extraData - Extra data from `signCreateDataSet`.
 * @returns The payer and client data set ID {@link decodeCreateDataSetExtraData.OutputType}
 * @throws Errors {@link decodeCreateDataSetExtraData.ErrorType}
 */
export function decodeCreateDataSetExtraData(extraData: Hex): decodeCreateDataSetExtraData.OutputType {
  const [payer, clientDataSetId] = decodeAbiParameters(signCreateDataSetAbiParameters, extraData)
  return { payer, clientDataSetId }
}

export namespace decodeCreateDataSetAndAddPiecesExtraData {
  export type OutputType = decodeCreateDataSetExtraData.OutputType & decodeAddPiecesExtraData.OutputType
  export type ErrorType = DecodeAbiParametersErrorType
}

/**
 * Decode the payer, client data set ID and nonce from create data set and add pieces extra data.
 *
 * @param extraData - Extra data from `signCreateDataSetAndAddPieces`.
 * @returns The decoded fields {@link decodeCreateDataSetAndAddPiecesExtraData.OutputType}
 * @throws Errors {@link decodeCreateDataSetAndAddPiecesExtraData.ErrorType}
 */
export function decodeCreateDataSetAndAddPiecesExtraData(
  extraData: Hex
): decodeCreateDataSetAndAddPiecesExtraData.OutputType {
  const [createExtraData, addExtraData] = decodeAbiParameters(signcreateDataSetAndAddPiecesAbiParameters, extraData)
  return {
    ...decodeCreateDataSetExtraData(createExtraData),
    ...decodeAddPiecesExtraData(addExtraData),
  }
}
