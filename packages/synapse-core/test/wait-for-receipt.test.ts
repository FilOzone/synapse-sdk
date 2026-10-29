import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  type Hex,
  http,
  numberToHex,
  type RpcTransaction,
  WaitForTransactionReceiptTimeoutError,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { ValidationError } from '../src/errors/base.ts'
import { TransactionNotAppliedError } from '../src/errors/pdp.ts'
import {
  ADDRESSES,
  dataSetCreatedLog,
  JSONRPC,
  PRIVATE_KEYS,
  pieceAddedLog,
  presets,
  type RpcLog,
  SP_SENDER,
} from '../src/mocks/jsonrpc/index.ts'
import { waitForAddPieces, waitForCreateDataSet, waitForCreateDataSetAddPieces } from '../src/sp/index.ts'
import {
  signAddPiecesAbiParameters,
  signCreateDataSetAbiParameters,
  signcreateDataSetAndAddPiecesAbiParameters,
} from '../src/typed-data/index.ts'
import {
  getAddPiecesResult,
  getCreateDataSetAndAddPiecesResult,
  getCreateDataSetResult,
} from '../src/warm-storage/index.ts'

const client = createPublicClient({ chain: calibration, transport: http(), pollingInterval: 10 })

const payer = ADDRESSES.client1
// Curio's sending wallet
const sender = SP_SENDER
const fwss = calibration.contracts.fwss.address
// Hash from the Location header
const originalTxHash: Hex = '0x1111111111111111111111111111111111111111111111111111111111111111'
// Hash Curio actually landed after replacing the message
const replacementTxHash: Hex = '0x2222222222222222222222222222222222222222222222222222222222222222'
const callInput: Hex = '0xdeadbeef'

const addNonce = 42n
const clientDataSetId = 7n
// Two pieces without metadata: `signAddPieces` compacts the per-piece metadata to empty arrays
const addExtraData = encodeAbiParameters(signAddPiecesAbiParameters, [addNonce, [], [], '0x'])
const pieceCount = 2
const createExtraData = encodeAbiParameters(signCreateDataSetAbiParameters, [payer, clientDataSetId, [], [], '0x'])
const createAndAddExtraData = encodeAbiParameters(signcreateDataSetAndAddPiecesAbiParameters, [
  createExtraData,
  addExtraData,
])

function transaction(hash: Hex, overrides: { to?: Address; input?: Hex; blockNumber?: bigint } = {}) {
  return {
    hash,
    from: sender,
    to: overrides.to ?? fwss,
    nonce: '0x5',
    value: '0x0',
    input: overrides.input ?? callInput,
    gas: '0x1',
    gasPrice: '0x1',
    type: '0x0',
    chainId: numberToHex(calibration.id),
    v: '0x1b',
    r: '0x1',
    s: '0x1',
    blockHash: overrides.blockNumber == null ? null : `0x${'ab'.repeat(32)}`,
    blockNumber: overrides.blockNumber == null ? null : numberToHex(overrides.blockNumber),
    transactionIndex: overrides.blockNumber == null ? null : '0x0',
  }
}

function receipt(hash: Hex, logs: RpcLog[], status: '0x1' | '0x0' = '0x1') {
  return {
    ...presets.basic.eth_getTransactionReceipt([hash]),
    transactionHash: hash,
    from: sender,
    to: fwss,
    logs,
    status,
  }
}

type Scenario = {
  /** Receipt logs of the landed transaction. */
  logs?: RpcLog[]
  /** Whether the landed transaction reverted. */
  reverted?: boolean
  /** The replacement, or none when the original lands. */
  replacement?: ReturnType<typeof transaction>
  /** Whether the node can still return the original transaction. */
  originalKnown?: boolean
  /** Value FWSS stores for the nonce. */
  clientNonce?: bigint
}

/**
 * Mock the RPC for a Curio-submitted transaction. With a replacement, the original never gets a
 * receipt and the replacement (same sender and nonce) is in the latest block, like viem expects.
 */
function mockChain(scenario: Scenario) {
  const landedHash = scenario.replacement?.hash ?? originalTxHash
  return JSONRPC({
    ...presets.basic,
    eth_getTransactionByHash: ([hash]: [Hex]) => {
      if (hash === originalTxHash && scenario.originalKnown !== false) {
        return transaction(originalTxHash)
      }
      return null
    },
    eth_getTransactionReceipt: ([hash]: [Hex]) => {
      if (hash !== landedHash || scenario.originalKnown === false) {
        return null
      }
      return receipt(hash, scenario.logs ?? [], scenario.reverted === true ? '0x0' : '0x1')
    },
    eth_getBlockByNumber: (params) => {
      const block = presets.basic.eth_getBlockByNumber(params)
      if (block == null) {
        return null
      }
      const transactions =
        scenario.replacement == null ? [] : [scenario.replacement as unknown as RpcTransaction<false>]
      return { ...block, transactions }
    },
    warmStorageView: {
      ...presets.basic.warmStorageView,
      clientNonces: () => [scenario.clientNonce ?? 0n],
    },
  })
}

describe('chain-only submission results', () => {
  const server = setup()

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('submission results from clientNonces', () => {
    it('reports added pieces with their data set and piece IDs', async () => {
      let args: readonly unknown[] = []
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            // next piece ID 12 after adding 2 pieces to data set 3
            clientNonces: (callArgs) => {
              args = callArgs
              return [(12n << 128n) | 3n]
            },
          },
        })
      )

      const result = await getAddPiecesResult(client, { payer, extraData: addExtraData, pieceCount })
      assert.deepStrictEqual(result, { added: true, dataSetId: 3n, pieceIds: [10n, 11n] })
      assert.deepStrictEqual(args, [payer, addNonce])
    })

    it('reports not added for an unused nonce', async () => {
      server.use(mockChain({ clientNonce: 0n }))

      const result = await getAddPiecesResult(client, { payer, extraData: addExtraData, pieceCount })
      assert.deepStrictEqual(result, { added: false })
    })

    it('reports a created data set using the payer and client data set ID from the extra data', async () => {
      let args: readonly unknown[] = []
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientNonces: (callArgs) => {
              args = callArgs
              return [9n]
            },
          },
        })
      )

      const result = await getCreateDataSetResult(client, { extraData: createExtraData })
      assert.deepStrictEqual(result, { created: true, dataSetId: 9n })
      assert.deepStrictEqual(args, [payer, clientDataSetId])
    })

    it('reports create and add using the add pieces nonce', async () => {
      let args: readonly unknown[] = []
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientNonces: (callArgs) => {
              args = callArgs
              return [(2n << 128n) | 9n]
            },
          },
        })
      )

      const result = await getCreateDataSetAndAddPiecesResult(client, { extraData: createAndAddExtraData, pieceCount })
      assert.deepStrictEqual(result, { created: true, dataSetId: 9n, pieceIds: [0n, 1n] })
      assert.deepStrictEqual(args, [payer, addNonce])
    })

    it('reports not created for an unused client data set ID', async () => {
      server.use(mockChain({ clientNonce: 0n }))

      assert.deepStrictEqual(await getCreateDataSetResult(client, { extraData: createExtraData }), {
        created: false,
      })
      assert.deepStrictEqual(
        await getCreateDataSetAndAddPiecesResult(client, { extraData: createAndAddExtraData, pieceCount }),
        {
          created: false,
        }
      )
    })
  })

  describe('waitForAddPieces', () => {
    const options = { client, txHash: originalTxHash, extraData: addExtraData, payer, pieceCount }

    it('resolves from the original receipt, ignoring logs from other contracts', async () => {
      server.use(
        mockChain({
          logs: [
            { ...pieceAddedLog(originalTxHash, 99n, 99n, 0), address: ADDRESSES.client1 },
            pieceAddedLog(originalTxHash, 3n, 10n, 1),
            pieceAddedLog(originalTxHash, 3n, 11n, 2),
          ],
        })
      )

      const result = await waitForAddPieces(options)
      assert.deepStrictEqual(result, {
        txHash: originalTxHash,
        confirmedTxHash: originalTxHash,
        dataSetId: 3n,
        pieceIds: [10n, 11n],
      })
    })

    it('follows a replace-by-fee replacement that succeeded', async () => {
      server.use(
        mockChain({
          replacement: transaction(replacementTxHash, { blockNumber: 1000000n }),
          logs: [pieceAddedLog(replacementTxHash, 3n, 10n, 0), pieceAddedLog(replacementTxHash, 3n, 11n, 1)],
        })
      )

      const result = await waitForAddPieces(options)
      assert.deepStrictEqual(result, {
        txHash: originalTxHash,
        confirmedTxHash: replacementTxHash,
        replacement: 'repriced',
        dataSetId: 3n,
        pieceIds: [10n, 11n],
      })
    })

    it('throws TransactionNotAppliedError when the replacement was a cancellation', async () => {
      server.use(
        mockChain({
          // A cancellation is a zero-value self-send with the same nonce
          replacement: transaction(replacementTxHash, { to: sender, input: '0x', blockNumber: 1000000n }),
        })
      )

      try {
        await waitForAddPieces(options)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, TransactionNotAppliedError)
        assert.strictEqual(error.txHash, originalTxHash)
        assert.strictEqual(error.confirmedTxHash, replacementTxHash)
        assert.strictEqual(error.replacement, 'cancelled')
        assert.isFalse(error.reverted)
      }
    })

    it('checks chain state when a replacement with different calldata landed', async () => {
      server.use(
        mockChain({
          replacement: transaction(replacementTxHash, { input: '0xfeedface', blockNumber: 1000000n }),
          clientNonce: (12n << 128n) | 3n,
        })
      )

      const result = await waitForAddPieces(options)
      assert.strictEqual(result.replacement, 'replaced')
      assert.strictEqual(result.confirmedTxHash, replacementTxHash)
      assert.deepStrictEqual(result.pieceIds, [10n, 11n])
    })

    it('throws TransactionNotAppliedError when the transaction reverted', async () => {
      server.use(mockChain({ reverted: true }))

      try {
        await waitForAddPieces(options)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, TransactionNotAppliedError)
        assert.isTrue(error.reverted)
        assert.isUndefined(error.replacement)
      }
    })

    it('falls back to chain state when the receipt wait times out', async () => {
      // The node no longer knows the original, so viem cannot follow the replacement
      server.use(mockChain({ originalKnown: false, clientNonce: (12n << 128n) | 3n }))

      const result = await waitForAddPieces({ ...options, timeout: 100 })
      assert.deepStrictEqual(result, {
        txHash: originalTxHash,
        dataSetId: 3n,
        pieceIds: [10n, 11n],
      })
    })

    it("defaults the payer to the client's payer", async () => {
      let args: readonly unknown[] = []
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_getTransactionByHash: () => null,
          eth_getTransactionReceipt: () => null,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientNonces: (callArgs) => {
              args = callArgs
              return [(12n << 128n) | 3n]
            },
          },
        })
      )
      const walletClient = createWalletClient({
        account: privateKeyToAccount(PRIVATE_KEYS.key1),
        chain: calibration,
        transport: http(),
        pollingInterval: 10,
      })

      const { payer: _, ...withoutPayer } = options
      const result = await waitForAddPieces({ ...withoutPayer, client: walletClient, timeout: 100 })
      assert.deepStrictEqual(result.pieceIds, [10n, 11n])
      assert.deepStrictEqual(args, [walletClient.account.address, addNonce])
    })

    it('requires a payer when the client has no account', async () => {
      const { payer: _, ...withoutPayer } = options
      try {
        await waitForAddPieces(withoutPayer)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, ValidationError)
      }
    })

    it('rethrows the timeout when the nonce is still unused', async () => {
      server.use(mockChain({ originalKnown: false, clientNonce: 0n }))

      try {
        await waitForAddPieces({ ...options, timeout: 100 })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, WaitForTransactionReceiptTimeoutError)
      }
    })

    it('rejects with AbortError when aborted', async () => {
      server.use(mockChain({ originalKnown: false }))
      const controller = new AbortController()
      const wait = waitForAddPieces({ ...options, timeout: 1000, signal: controller.signal })
      controller.abort()

      try {
        await wait
        assert.fail('Should have thrown')
      } catch (error) {
        assert.strictEqual((error as Error).name, 'AbortError')
      }
    })
  })

  describe('waitForCreateDataSet', () => {
    const options = { client, txHash: originalTxHash, extraData: createExtraData }

    it('follows a replace-by-fee replacement that succeeded', async () => {
      server.use(
        mockChain({
          replacement: transaction(replacementTxHash, { blockNumber: 1000000n }),
          logs: [dataSetCreatedLog(replacementTxHash, 9n, 0)],
        })
      )

      const result = await waitForCreateDataSet(options)
      assert.deepStrictEqual(result, {
        txHash: originalTxHash,
        confirmedTxHash: replacementTxHash,
        replacement: 'repriced',
        dataSetId: 9n,
      })
    })

    it('throws TransactionNotAppliedError when the replacement was a cancellation', async () => {
      server.use(
        mockChain({ replacement: transaction(replacementTxHash, { to: sender, input: '0x', blockNumber: 1000000n }) })
      )

      try {
        await waitForCreateDataSet(options)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, TransactionNotAppliedError)
        assert.strictEqual(error.replacement, 'cancelled')
      }
    })

    it('falls back to chain state when the receipt wait times out', async () => {
      server.use(mockChain({ originalKnown: false, clientNonce: 9n }))

      const result = await waitForCreateDataSet({ ...options, timeout: 100 })
      assert.deepStrictEqual(result, { txHash: originalTxHash, dataSetId: 9n })
    })
  })

  describe('waitForCreateDataSetAddPieces', () => {
    it('follows a replace-by-fee replacement that succeeded', async () => {
      server.use(
        mockChain({
          replacement: transaction(replacementTxHash, { blockNumber: 1000000n }),
          logs: [
            dataSetCreatedLog(replacementTxHash, 9n, 0),
            pieceAddedLog(replacementTxHash, 9n, 0n, 1),
            pieceAddedLog(replacementTxHash, 9n, 1n, 2),
          ],
        })
      )

      const result = await waitForCreateDataSetAddPieces({
        client,
        txHash: originalTxHash,
        extraData: createAndAddExtraData,
        pieceCount,
      })
      assert.deepStrictEqual(result, {
        txHash: originalTxHash,
        confirmedTxHash: replacementTxHash,
        replacement: 'repriced',
        dataSetId: 9n,
        pieceIds: [0n, 1n],
      })
    })
  })
})
