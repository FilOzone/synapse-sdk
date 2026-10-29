import type { AbortError } from 'iso-web/http'
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  type Hex,
  isAddressEqual,
  parseEventLogs,
  type ReplacementReason,
  type TransactionReceipt,
  type Transport,
  WaitForTransactionReceiptTimeoutError,
} from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { asChain } from '../chains.ts'
import { ValidationError } from '../errors/base.ts'
import { TransactionNotAppliedError } from '../errors/pdp.ts'
import { abortable, throwIfAborted } from '../utils/abort.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { getPayerAddress } from '../utils/payer.ts'
import {
  getAddPiecesResult,
  getCreateDataSetAndAddPiecesResult,
  getCreateDataSetResult,
} from '../warm-storage/submission-result.ts'

export namespace waitForSubmission {
  export type OptionsType = {
    /** The client to read the chain with. */
    client: Client<Transport, Chain, Account | undefined>
    /** The original transaction hash returned by the SP. */
    txHash: Hex
    /** The signed extra data that was submitted. Used to check chain state if the receipt wait times out. */
    extraData: Hex
    /** The timeout in milliseconds. Defaults to {@link RETRY_CONSTANTS.TIMEOUT}. */
    timeout?: number
    /** The signal to abort the wait. Aborting stops waiting; viem's own polling stops at `timeout`. */
    signal?: AbortSignal
  }
  export type OutputType = {
    /** The original transaction hash returned by the SP. */
    txHash: Hex
    /** Hash of the transaction that landed. Absent when the outcome was found from chain state after a timeout. */
    confirmedTxHash?: Hex
    /** How the original was replaced, when it was. */
    replacement?: ReplacementReason
  }
  export type ErrorType = TransactionNotAppliedError | WaitForTransactionReceiptTimeoutError | AbortError
}

/**
 * Wait for an SP-submitted transaction, following replacements, and extract its outcome.
 *
 * @param options - The wait options.
 * @param fromReceipt - Extract the outcome from a successful receipt, or undefined if the call was not applied.
 * @param fromChainState - Look the outcome up from chain state, or undefined if it has not landed.
 */
async function waitForSubmission<T extends object>(
  options: waitForSubmission.OptionsType,
  fromReceipt: (receipt: TransactionReceipt) => T | undefined,
  fromChainState: () => Promise<T | undefined>
): Promise<T & waitForSubmission.OutputType> {
  throwIfAborted(options.signal)
  let replacement: ReplacementReason | undefined
  let receipt: TransactionReceipt
  try {
    receipt = await abortable(
      waitForTransactionReceipt(options.client, {
        hash: options.txHash,
        timeout: options.timeout ?? RETRY_CONSTANTS.TIMEOUT,
        onReplaced: (response) => {
          replacement = response.reason
        },
      }),
      options.signal
    )
  } catch (error) {
    if (!(error instanceof WaitForTransactionReceiptTimeoutError)) {
      throw error
    }
    // viem can only follow a replacement it sees while polling, and only after fetching the original,
    // so a replacement can land unnoticed. The nonce FWSS records is the source of truth.
    const result = await fromChainState()
    if (result == null) {
      throw error
    }
    return { ...result, txHash: options.txHash }
  }

  const result = await outcomeFromReceipt(receipt, replacement, fromReceipt, fromChainState)
  if (result == null) {
    throw new TransactionNotAppliedError({
      txHash: options.txHash,
      confirmedTxHash: receipt.transactionHash,
      reverted: receipt.status !== 'success',
      replacement,
    })
  }
  return {
    ...result,
    txHash: options.txHash,
    confirmedTxHash: receipt.transactionHash,
    ...(replacement == null ? {} : { replacement }),
  }
}

/**
 * Extract the outcome of a landed transaction, or undefined if it did not apply the call.
 */
async function outcomeFromReceipt<T extends object>(
  receipt: TransactionReceipt,
  replacement: ReplacementReason | undefined,
  fromReceipt: (receipt: TransactionReceipt) => T | undefined,
  fromChainState: () => Promise<T | undefined>
): Promise<T | undefined> {
  if (receipt.status !== 'success') {
    return undefined
  }
  // A `replaced` transaction carries different calldata, so its logs are not ours: ask chain state instead
  if (replacement === 'replaced') {
    return fromChainState()
  }
  return fromReceipt(receipt)
}

function fwssLogs<const eventName extends 'PieceAdded' | 'DataSetCreated'>(
  client: Client<Transport, Chain, Account | undefined>,
  receipt: TransactionReceipt,
  eventName: eventName
) {
  const fwss = asChain(client.chain).contracts.fwss
  return parseEventLogs({ abi: fwss.abi, eventName, logs: receipt.logs }).filter((log) =>
    isAddressEqual(log.address, fwss.address)
  )
}

function pieceIdsFromReceipt(client: Client<Transport, Chain, Account | undefined>, receipt: TransactionReceipt) {
  const logs = fwssLogs(client, receipt, 'PieceAdded')
  const first = logs[0]
  if (first == null) {
    return undefined
  }
  return { dataSetId: first.args.dataSetId, pieceIds: logs.map((log) => log.args.pieceId) }
}

export namespace waitForAddPieces {
  export type OptionsType = waitForSubmission.OptionsType & {
    /**
     * The payer of the data set the pieces are added to. Defaults to the client's payer
     * (the root address for a session key client). Required when the client has no account.
     */
    payer?: Address
    /** The number of pieces submitted, see `addPiecesApiRequest.OutputType.pieceCount`. */
    pieceCount: number
  }
  export type OutputType = waitForSubmission.OutputType & {
    /** The data set the pieces were added to. */
    dataSetId: bigint
    /** The piece IDs assigned on chain, in submission order. */
    pieceIds: bigint[]
  }
  export type ErrorType = waitForSubmission.ErrorType | ValidationError | getAddPiecesResult.ErrorType
}

/**
 * Wait for an add pieces transaction on chain, following replace-by-fee replacements.
 *
 * Uses viem's `waitForTransactionReceipt` on the hash the SP returned, so a sped-up or repriced
 * replacement resolves with its own hash in `confirmedTxHash`. If the wait times out, it checks the
 * nonce FWSS records before failing, in case a replacement landed unnoticed.
 *
 * For recovery after a crash, call `getAddPiecesResult` with the persisted `extraData` instead:
 * after a replacement the original hash can no longer be looked up.
 *
 * @example
 * ```ts
 * const result = await SP.addPieces(client, options)
 * const { dataSetId, pieceIds, confirmedTxHash } = await SP.waitForAddPieces({ client, ...result })
 * ```
 *
 * @param options - {@link waitForAddPieces.OptionsType}
 * @returns The outcome {@link waitForAddPieces.OutputType}
 * @throws Errors {@link waitForAddPieces.ErrorType}. {@link TransactionNotAppliedError} when the landed transaction reverted or was a cancellation.
 */
export async function waitForAddPieces(options: waitForAddPieces.OptionsType): Promise<waitForAddPieces.OutputType> {
  const account = options.client.account
  if (options.payer == null && account == null) {
    throw new ValidationError('`payer` is required when the client has no account.')
  }
  const payer = options.payer ?? getPayerAddress(account as Account)
  return waitForSubmission(
    options,
    (receipt) => pieceIdsFromReceipt(options.client, receipt),
    async () => {
      const result = await getAddPiecesResult(options.client, {
        payer,
        extraData: options.extraData,
        pieceCount: options.pieceCount,
      })
      return result.added ? { dataSetId: result.dataSetId, pieceIds: result.pieceIds } : undefined
    }
  )
}

export namespace waitForCreateDataSet {
  export type OptionsType = waitForSubmission.OptionsType
  export type OutputType = waitForSubmission.OutputType & {
    /** The created data set ID. */
    dataSetId: bigint
  }
  export type ErrorType = waitForSubmission.ErrorType | getCreateDataSetResult.ErrorType
}

/**
 * Wait for a create data set transaction on chain, following replace-by-fee replacements.
 *
 * See {@link waitForAddPieces}. For recovery after a crash, call `getCreateDataSetResult`.
 *
 * @example
 * ```ts
 * const result = await SP.createDataSet(client, options)
 * const { dataSetId } = await SP.waitForCreateDataSet({ client, ...result })
 * ```
 *
 * @param options - {@link waitForCreateDataSet.OptionsType}
 * @returns The outcome {@link waitForCreateDataSet.OutputType}
 * @throws Errors {@link waitForCreateDataSet.ErrorType}
 */
export async function waitForCreateDataSet(
  options: waitForCreateDataSet.OptionsType
): Promise<waitForCreateDataSet.OutputType> {
  return waitForSubmission(
    options,
    (receipt) => {
      const created = fwssLogs(options.client, receipt, 'DataSetCreated')[0]
      return created == null ? undefined : { dataSetId: created.args.dataSetId }
    },
    async () => {
      const result = await getCreateDataSetResult(options.client, { extraData: options.extraData })
      return result.created ? { dataSetId: result.dataSetId } : undefined
    }
  )
}

export namespace waitForCreateDataSetAddPieces {
  export type OptionsType = waitForSubmission.OptionsType & {
    /** The number of pieces submitted, see `createDataSetAndAddPiecesApiRequest.OutputType.pieceCount`. */
    pieceCount: number
  }
  export type OutputType = waitForSubmission.OutputType & {
    /** The created data set ID. */
    dataSetId: bigint
    /** The piece IDs assigned on chain, in submission order. */
    pieceIds: bigint[]
  }
  export type ErrorType = waitForSubmission.ErrorType | getCreateDataSetAndAddPiecesResult.ErrorType
}

/**
 * Wait for a create data set and add pieces transaction on chain, following replace-by-fee replacements.
 *
 * See {@link waitForAddPieces}. For recovery after a crash, call `getCreateDataSetAndAddPiecesResult`.
 *
 * @example
 * ```ts
 * const result = await SP.createDataSetAndAddPieces(client, options)
 * const { dataSetId, pieceIds } = await SP.waitForCreateDataSetAddPieces({ client, ...result })
 * ```
 *
 * @param options - {@link waitForCreateDataSetAddPieces.OptionsType}
 * @returns The outcome {@link waitForCreateDataSetAddPieces.OutputType}
 * @throws Errors {@link waitForCreateDataSetAddPieces.ErrorType}
 */
export async function waitForCreateDataSetAddPieces(
  options: waitForCreateDataSetAddPieces.OptionsType
): Promise<waitForCreateDataSetAddPieces.OutputType> {
  return waitForSubmission(
    options,
    (receipt) => pieceIdsFromReceipt(options.client, receipt),
    async () => {
      const result = await getCreateDataSetAndAddPiecesResult(options.client, {
        extraData: options.extraData,
        pieceCount: options.pieceCount,
      })
      return result.created ? { dataSetId: result.dataSetId, pieceIds: result.pieceIds } : undefined
    }
  )
}
