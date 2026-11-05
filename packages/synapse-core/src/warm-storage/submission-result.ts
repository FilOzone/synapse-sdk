import type { Address, Chain, Client, Hex, Transport } from 'viem'
import {
  decodeAddPiecesExtraData,
  decodeCreateDataSetAndAddPiecesExtraData,
  decodeCreateDataSetExtraData,
} from '../typed-data/decode-extra-data.ts'
import { getClientNonce } from './get-client-nonce.ts'

const LOW_128_BITS = (1n << 128n) - 1n

/**
 * Decode the value FWSS stores for a used add pieces nonce: `(nextPieceId << 128) | dataSetId`.
 *
 * @param value - The non-zero stored value.
 * @param pieceCount - The number of pieces the nonce authorized.
 */
function decodeAddPiecesNonceValue(value: bigint, pieceCount: number) {
  const nextPieceId = value >> 128n
  const firstPieceId = nextPieceId - BigInt(pieceCount)
  return {
    dataSetId: value & LOW_128_BITS,
    pieceIds: Array.from({ length: pieceCount }, (_, i) => firstPieceId + BigInt(i)),
  }
}

export namespace getAddPiecesResult {
  export type OptionsType = {
    /** The payer of the data set the pieces were added to. */
    payer: Address
    /** The signed extra data that was submitted, see `addPiecesApiRequest.OutputType.extraData`. */
    extraData: Hex
    /** The number of pieces submitted, see `addPiecesApiRequest.OutputType.pieceCount`. The extra data does not record it. */
    pieceCount: number
  }
  export type OutputType = { added: false } | { added: true; dataSetId: bigint; pieceIds: bigint[] }
  export type ErrorType = decodeAddPiecesExtraData.ErrorType | getClientNonce.ErrorType
}

/**
 * Check on chain whether an add pieces submission landed, without the SP or any transaction hash.
 *
 * FWSS records each used add pieces nonce, so this works whichever transaction carried the call,
 * including a replace-by-fee replacement whose hash was never seen. If `added` is false, resubmitting
 * the same `extraData` is safe: FWSS rejects a reused nonce, so the pieces can never be added twice.
 * Do not sign new extra data for the same pieces while the original could still land.
 *
 * @param client - The client to use to read the nonce.
 * @param options - {@link getAddPiecesResult.OptionsType}
 * @returns The result {@link getAddPiecesResult.OutputType}
 * @throws Errors {@link getAddPiecesResult.ErrorType}
 *
 * @example
 * ```ts
 * import { getAddPiecesResult } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // `extraData` and `pieceCount` were persisted from `addPieces` before a crash
 * const result = await getAddPiecesResult(client, {
 *   payer: '0x0000000000000000000000000000000000000000',
 *   extraData: '0x...',
 *   pieceCount: 2,
 * })
 *
 * if (result.added) {
 *   console.log(result.dataSetId, result.pieceIds)
 * }
 * ```
 */
export async function getAddPiecesResult(
  client: Client<Transport, Chain>,
  options: getAddPiecesResult.OptionsType
): Promise<getAddPiecesResult.OutputType> {
  const { nonce } = decodeAddPiecesExtraData(options.extraData)
  const value = await getClientNonce(client, { payer: options.payer, nonce })
  if (value === 0n) {
    return { added: false }
  }
  return { added: true, ...decodeAddPiecesNonceValue(value, options.pieceCount) }
}

export namespace getCreateDataSetResult {
  export type OptionsType = {
    /** The signed extra data that was submitted, see `createDataSetApiRequest.OutputType.extraData`. */
    extraData: Hex
  }
  export type OutputType = { created: false } | { created: true; dataSetId: bigint }
  export type ErrorType = decodeCreateDataSetExtraData.ErrorType | getClientNonce.ErrorType
}

/**
 * Check on chain whether a create data set submission landed, without the SP or any transaction hash.
 *
 * FWSS records each used client data set ID, so this works whichever transaction carried the call.
 * If `created` is false, resubmitting the same `extraData` is safe: FWSS rejects a reused client
 * data set ID, so a second data set can never be created from it.
 *
 * @param client - The client to use to read the nonce.
 * @param options - {@link getCreateDataSetResult.OptionsType}
 * @returns The result {@link getCreateDataSetResult.OutputType}
 * @throws Errors {@link getCreateDataSetResult.ErrorType}
 *
 * @example
 * ```ts
 * import { getCreateDataSetResult } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // `extraData` was persisted from `createDataSet` before a crash
 * const result = await getCreateDataSetResult(client, { extraData: '0x...' })
 *
 * if (result.created) {
 *   console.log(result.dataSetId)
 * }
 * ```
 */
export async function getCreateDataSetResult(
  client: Client<Transport, Chain>,
  options: getCreateDataSetResult.OptionsType
): Promise<getCreateDataSetResult.OutputType> {
  const { payer, clientDataSetId } = decodeCreateDataSetExtraData(options.extraData)
  const dataSetId = await getClientNonce(client, { payer, nonce: clientDataSetId })
  if (dataSetId === 0n) {
    return { created: false }
  }
  return { created: true, dataSetId }
}

export namespace getCreateDataSetAndAddPiecesResult {
  export type OptionsType = {
    /** The signed extra data that was submitted, see `createDataSetAndAddPiecesApiRequest.OutputType.extraData`. */
    extraData: Hex
    /** The number of pieces submitted, see `createDataSetAndAddPiecesApiRequest.OutputType.pieceCount`. The extra data does not record it. */
    pieceCount: number
  }
  export type OutputType = { created: false } | { created: true; dataSetId: bigint; pieceIds: bigint[] }
  export type ErrorType = decodeCreateDataSetAndAddPiecesExtraData.ErrorType | getClientNonce.ErrorType
}

/**
 * Check on chain whether a create data set and add pieces submission landed, without the SP or any transaction hash.
 *
 * Both happen in one transaction, so the add pieces nonce alone tells whether it landed and
 * gives the data set ID and piece IDs. If `created` is false, resubmitting the same `extraData` is safe.
 *
 * @param client - The client to use to read the nonce.
 * @param options - {@link getCreateDataSetAndAddPiecesResult.OptionsType}
 * @returns The result {@link getCreateDataSetAndAddPiecesResult.OutputType}
 * @throws Errors {@link getCreateDataSetAndAddPiecesResult.ErrorType}
 *
 * @example
 * ```ts
 * import { getCreateDataSetAndAddPiecesResult } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // `extraData` and `pieceCount` were persisted from `createDataSetAndAddPieces` before a crash
 * const result = await getCreateDataSetAndAddPiecesResult(client, {
 *   extraData: '0x...',
 *   pieceCount: 1,
 * })
 *
 * if (result.created) {
 *   console.log(result.dataSetId, result.pieceIds)
 * }
 * ```
 */
export async function getCreateDataSetAndAddPiecesResult(
  client: Client<Transport, Chain>,
  options: getCreateDataSetAndAddPiecesResult.OptionsType
): Promise<getCreateDataSetAndAddPiecesResult.OutputType> {
  const { payer, nonce } = decodeCreateDataSetAndAddPiecesExtraData(options.extraData)
  const value = await getClientNonce(client, { payer, nonce })
  if (value === 0n) {
    return { created: false }
  }
  return { created: true, ...decodeAddPiecesNonceValue(value, options.pieceCount) }
}
