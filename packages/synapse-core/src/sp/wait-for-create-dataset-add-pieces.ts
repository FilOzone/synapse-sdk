import type { AbortError, NetworkError, TimeoutError } from 'iso-web/http'
import type {
  WaitForAddPiecesError,
  WaitForAddPiecesRejectedError,
  WaitForCreateDataSetError,
  WaitForCreateDataSetRejectedError,
} from '../errors/pdp.ts'
import { waitForAddPieces } from './wait-for-add-pieces.ts'
import { waitForCreateDataSet } from './wait-for-create-dataset.ts'

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
