import { type Address, encodeAbiParameters, encodeEventTopics, type Hex, numberToHex } from 'viem'
import * as Abis from '../../abis/index.ts'
import { calibration } from '../../chains.ts'
import { ADDRESSES } from './constants.ts'
import type { JSONRPCOptions } from './types.ts'

/** Curio's sending wallet in mocked SP transactions. */
export const SP_SENDER: Address = '0x00000000000000000000000000000000000c0410'

const BLOCK_HASH: Hex = `0x${'ab'.repeat(32)}`
const BLOCK_NUMBER = 1000000n

export type RpcLog = {
  address: Address
  topics: Hex[]
  data: Hex
  blockHash: Hex
  blockNumber: Hex
  transactionHash: Hex
  transactionIndex: Hex
  logIndex: Hex
  removed: boolean
}

function fwssLog(txHash: Hex, topics: Hex[], data: Hex, logIndex: number): RpcLog {
  return {
    address: calibration.contracts.fwss.address,
    topics,
    data,
    blockHash: BLOCK_HASH,
    blockNumber: numberToHex(BLOCK_NUMBER),
    transactionHash: txHash,
    transactionIndex: '0x0',
    logIndex: numberToHex(logIndex),
    removed: false,
  }
}

function eventDataInputs(name: 'PieceAdded' | 'DataSetCreated') {
  const event = Abis.fwss.find((item) => item.type === 'event' && item.name === name)
  return event?.type === 'event' ? event.inputs.filter((input) => !input.indexed) : []
}

/**
 * An FWSS `PieceAdded` log.
 *
 * @param txHash - The transaction hash.
 * @param dataSetId - The data set ID.
 * @param pieceId - The piece ID.
 * @param logIndex - The log index in the receipt.
 */
export function pieceAddedLog(txHash: Hex, dataSetId: bigint, pieceId: bigint, logIndex: number): RpcLog {
  return fwssLog(
    txHash,
    encodeEventTopics({ abi: Abis.fwss, eventName: 'PieceAdded', args: { dataSetId, pieceId } }) as Hex[],
    encodeAbiParameters(eventDataInputs('PieceAdded'), [{ data: '0x01' }, [], []]),
    logIndex
  )
}

/**
 * An FWSS `DataSetCreated` log.
 *
 * @param txHash - The transaction hash.
 * @param dataSetId - The created data set ID.
 * @param logIndex - The log index in the receipt.
 */
export function dataSetCreatedLog(txHash: Hex, dataSetId: bigint, logIndex: number): RpcLog {
  return fwssLog(
    txHash,
    encodeEventTopics({ abi: Abis.fwss, eventName: 'DataSetCreated', args: { dataSetId, providerId: 1n } }) as Hex[],
    encodeAbiParameters(eventDataInputs('DataSetCreated'), [
      1n,
      0n,
      0n,
      ADDRESSES.client1,
      SP_SENDER,
      SP_SENDER,
      [],
      [],
    ]),
    logIndex
  )
}

/**
 * How an SP-submitted transaction landed.
 *
 * - `{ dataSetId, pieceIds }`: add pieces. Add `created: true` for create data set (and add pieces).
 * - `{ reverted: true }`: the transaction reverted.
 */
export type LandedTransaction =
  | { dataSetId: bigint; pieceIds?: bigint[]; created?: boolean; reverted?: false }
  | { reverted: true }

/**
 * The FWSS logs of a landed transaction.
 *
 * @param txHash - The transaction hash.
 * @param landed - {@link LandedTransaction}
 */
export function landedLogs(txHash: Hex, landed: LandedTransaction): RpcLog[] {
  if (landed.reverted === true) {
    return []
  }
  const created = landed.created === true ? [dataSetCreatedLog(txHash, landed.dataSetId, 0)] : []
  const added = (landed.pieceIds ?? []).map((pieceId, i) =>
    pieceAddedLog(txHash, landed.dataSetId, pieceId, created.length + i)
  )
  return [...created, ...added]
}

/**
 * JSON-RPC handlers for transactions an SP submitted. Spread them into {@link JSONRPC} options.
 * Unknown hashes have no transaction or receipt, so a receipt wait keeps polling.
 *
 * @param transactions - How each transaction landed, keyed by hash, or a lookup that returns undefined for unknown hashes.
 * @returns `eth_getTransactionByHash` and `eth_getTransactionReceipt` handlers.
 *
 * @example
 * ```ts
 * server.use(
 *   Mocks.JSONRPC({
 *     ...Mocks.presets.basic,
 *     ...Mocks.landedTransactions({ [txHash]: { dataSetId: 1n, pieceIds: [0n] } }),
 *   })
 * )
 * ```
 */
export function landedTransactions(
  transactions: Record<Hex, LandedTransaction> | ((hash: Hex) => LandedTransaction | undefined)
): Required<Pick<JSONRPCOptions, 'eth_getTransactionByHash' | 'eth_getTransactionReceipt'>> {
  const find = (hash: Hex) => {
    if (typeof transactions === 'function') {
      return transactions(hash)
    }
    const key = Object.keys(transactions).find((item) => item.toLowerCase() === hash.toLowerCase()) as Hex | undefined
    return key == null ? undefined : transactions[key]
  }
  return {
    eth_getTransactionByHash: ([hash]: [Hex]) => {
      if (find(hash) == null) {
        return null
      }
      return {
        hash,
        from: SP_SENDER,
        to: calibration.contracts.fwss.address,
        nonce: '0x5',
        value: '0x0',
        input: '0xdeadbeef',
        gas: '0x1',
        gasPrice: '0x1',
        type: '0x0',
        chainId: numberToHex(calibration.id),
        v: '0x1b',
        r: '0x1',
        s: '0x1',
        blockHash: BLOCK_HASH,
        blockNumber: numberToHex(BLOCK_NUMBER),
        transactionIndex: '0x0',
      }
    },
    eth_getTransactionReceipt: ([hash]: [Hex]) => {
      const landed = find(hash)
      if (landed == null) {
        return null
      }
      return {
        transactionHash: hash,
        from: SP_SENDER,
        to: calibration.contracts.fwss.address,
        contractAddress: null,
        transactionIndex: '0x0',
        gasUsed: numberToHex(50000n),
        cumulativeGasUsed: numberToHex(50000n),
        effectiveGasPrice: numberToHex(1000000000n),
        logsBloom: `0x${'0'.repeat(512)}`,
        blockHash: BLOCK_HASH,
        blockNumber: numberToHex(BLOCK_NUMBER),
        type: '0x0',
        logs: landedLogs(hash, landed),
        status: landed.reverted === true ? '0x0' : '0x1',
      }
    },
  }
}
