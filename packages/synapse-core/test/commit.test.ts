import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createWalletClient, decodeAbiParameters, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Chains from '../src/chains.ts'
import { ZodValidationError } from '../src/errors/base.ts'
import { AtLeastOnePieceRequiredError } from '../src/errors/warm-storage.ts'
import { ADDRESSES, PRIVATE_KEYS } from '../src/mocks/index.ts'
import * as Piece from '../src/piece/index.ts'
import {
  type addPiecesApiRequest,
  type Commit,
  type createDataSetAndAddPiecesApiRequest,
  prepareAddPieces,
  prepareCreateDataSetAndAddPieces,
  submitCommit,
} from '../src/sp/index.ts'
import * as TypedData from '../src/typed-data/index.ts'
import { datasetMetadataObjectToEntry, pieceMetadataObjectToEntry } from '../src/utils/metadata.ts'

const account = privateKeyToAccount(PRIVATE_KEYS.key1)
const client = createWalletClient({
  account,
  chain: Chains.calibration,
  transport: viemHttp(),
})

const pieceCid = Piece.from('bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy')
const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

describe('commit', () => {
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

  describe('prepareAddPieces', () => {
    it('returns a JSON-safe commit signed like signAddPieces', async () => {
      const commit = await prepareAddPieces(client, {
        dataSetId: 7n,
        clientDataSetId: 3n,
        nonce: 5n,
        pieces: [{ pieceCid, metadata: { name: 'a' } }, { pieceCid }],
      })

      const extraData = await TypedData.signAddPieces(client, {
        clientDataSetId: 3n,
        nonce: 5n,
        pieces: [{ pieceCid, metadata: pieceMetadataObjectToEntry({ name: 'a' }) }, { pieceCid }],
      })
      assert.deepStrictEqual(commit, {
        kind: 'addPieces',
        dataSetId: '7',
        clientDataSetId: '3',
        nonce: '5',
        payer: account.address,
        pieces: [{ pieceCid: pieceCid.toString(), metadata: { name: 'a' } }, { pieceCid: pieceCid.toString() }],
        extraData,
      })
      assert.deepStrictEqual(JSON.parse(JSON.stringify(commit)), commit)
    })

    it('records the nonce it signed when none is given', async () => {
      const commit = await prepareAddPieces(client, { dataSetId: 1n, clientDataSetId: 1n, pieces: [{ pieceCid }] })
      const [nonce] = decodeAbiParameters(TypedData.signAddPiecesAbiParameters, commit.extraData)
      assert.strictEqual(commit.nonce, nonce.toString())
    })

    it('keeps what was signed when the caller mutates its input after prepare', async () => {
      const pieceMetadata = { name: 'before' }
      const pieces = [{ pieceCid, metadata: pieceMetadata }]
      const promise = prepareAddPieces(client, { dataSetId: 7n, clientDataSetId: 3n, nonce: 5n, pieces })
      pieceMetadata.name = 'after'
      pieces.push({ pieceCid, metadata: { name: 'extra' } })
      const commit = await promise

      const extraData = await TypedData.signAddPieces(client, {
        clientDataSetId: 3n,
        nonce: 5n,
        pieces: [{ pieceCid, metadata: pieceMetadataObjectToEntry({ name: 'before' }) }],
      })
      assert.strictEqual(commit.extraData, extraData)
      assert.deepStrictEqual(commit.pieces, [{ pieceCid: pieceCid.toString(), metadata: { name: 'before' } }])
    })

    it('rejects pieces that do not fit before signing', async () => {
      try {
        await prepareAddPieces(client, { dataSetId: 1n, clientDataSetId: 1n, pieces: [] })
        assert.fail('should have thrown')
      } catch (error) {
        assert.instanceOf(error, AtLeastOnePieceRequiredError)
      }
    })
  })

  describe('prepareCreateDataSetAndAddPieces', () => {
    it('returns a JSON-safe commit signed like signCreateDataSetAndAddPieces', async () => {
      const commit = await prepareCreateDataSetAndAddPieces(client, {
        payee: ADDRESSES.client1,
        clientDataSetId: 9n,
        nonce: 2n,
        metadata: { project: 'x' },
        cdn: true,
        pieces: [{ pieceCid }],
      })

      const extraData = await TypedData.signCreateDataSetAndAddPieces(client, {
        clientDataSetId: 9n,
        nonce: 2n,
        payee: ADDRESSES.client1,
        metadata: datasetMetadataObjectToEntry({ project: 'x' }, { cdn: true }),
        pieces: [{ pieceCid, metadata: [] }],
      })
      assert.deepStrictEqual(commit, {
        kind: 'createDataSetAndAddPieces',
        clientDataSetId: '9',
        nonce: '2',
        payee: ADDRESSES.client1,
        payer: account.address,
        metadata: { project: 'x' },
        cdn: true,
        pieces: [{ pieceCid: pieceCid.toString() }],
        extraData,
      })
      assert.deepStrictEqual(JSON.parse(JSON.stringify(commit)), commit)
    })

    it('records the client data set id and nonce it signed when none are given', async () => {
      const commit = await prepareCreateDataSetAndAddPieces(client, {
        payee: ADDRESSES.client1,
        pieces: [{ pieceCid }],
      })
      const [createExtraData, addExtraData] = decodeAbiParameters(
        TypedData.signcreateDataSetAndAddPiecesAbiParameters,
        commit.extraData
      )
      const [, clientDataSetId] = decodeAbiParameters(TypedData.signCreateDataSetAbiParameters, createExtraData)
      const [nonce] = decodeAbiParameters(TypedData.signAddPiecesAbiParameters, addExtraData)
      assert.strictEqual(commit.clientDataSetId, clientDataSetId.toString())
      assert.strictEqual(commit.nonce, nonce.toString())
      assert.strictEqual(commit.cdn, false)
      assert.notProperty(commit, 'metadata')
    })

    it('keeps what was signed when the caller mutates its input after prepare', async () => {
      const metadata = { project: 'before' }
      const pieceMetadata = { name: 'before' }
      const promise = prepareCreateDataSetAndAddPieces(client, {
        payee: ADDRESSES.client1,
        clientDataSetId: 9n,
        nonce: 2n,
        metadata,
        pieces: [{ pieceCid, metadata: pieceMetadata }],
      })
      metadata.project = 'after'
      pieceMetadata.name = 'after'
      const commit = await promise

      const extraData = await TypedData.signCreateDataSetAndAddPieces(client, {
        clientDataSetId: 9n,
        nonce: 2n,
        payee: ADDRESSES.client1,
        metadata: datasetMetadataObjectToEntry({ project: 'before' }, { cdn: false }),
        pieces: [{ pieceCid, metadata: pieceMetadataObjectToEntry({ name: 'before' }) }],
      })
      assert.strictEqual(commit.extraData, extraData)
      assert.deepStrictEqual(commit.metadata, { project: 'before' })
      assert.deepStrictEqual(commit.pieces, [{ pieceCid: pieceCid.toString(), metadata: { name: 'before' } }])

      metadata.project = 'later'
      assert.deepStrictEqual(commit.metadata, { project: 'before' })
    })

    it('rejects pieces that do not fit before signing', async () => {
      try {
        await prepareCreateDataSetAndAddPieces(client, { payee: ADDRESSES.client1, pieces: [] })
        assert.fail('should have thrown')
      } catch (error) {
        assert.instanceOf(error, AtLeastOnePieceRequiredError)
      }
    })
  })

  describe('submitCommit', () => {
    it('sends an addPieces commit loaded from JSON', async () => {
      let body: addPiecesApiRequest.RequestBody | undefined
      let dataSetId: string | undefined
      server.use(
        http.post<{ id: string }, addPiecesApiRequest.RequestBody>(
          'http://pdp.local/pdp/data-sets/:id/pieces',
          async ({ request, params }) => {
            body = await request.json()
            dataSetId = params.id
            return new HttpResponse(null, {
              status: 201,
              headers: { Location: `/pdp/data-sets/${params.id}/pieces/added/${mockTxHash}` },
            })
          }
        )
      )

      const prepared = await prepareAddPieces(client, {
        dataSetId: 7n,
        clientDataSetId: 3n,
        pieces: [{ pieceCid }, { pieceCid }],
      })
      const commit: Commit = JSON.parse(JSON.stringify(prepared))
      const result = await submitCommit(client, { serviceURL: 'http://pdp.local', commit })

      assert.strictEqual(dataSetId, '7')
      assert.strictEqual(body?.extraData, prepared.extraData)
      assert.deepStrictEqual(
        body?.pieces.map((piece) => piece.pieceCid),
        [pieceCid.toString(), pieceCid.toString()]
      )
      assert.deepStrictEqual(result, { txHash: mockTxHash, extraData: prepared.extraData, pieceCount: 2 })
    })

    it('sends a createDataSetAndAddPieces commit with the chain record keeper', async () => {
      let body: createDataSetAndAddPiecesApiRequest.RequestBody | undefined
      server.use(
        http.post<never, createDataSetAndAddPiecesApiRequest.RequestBody>(
          'http://pdp.local/pdp/data-sets/create-and-add',
          async ({ request }) => {
            body = await request.json()
            return new HttpResponse(null, {
              status: 201,
              headers: { Location: `/pdp/data-sets/created/${mockTxHash}` },
            })
          }
        )
      )

      const prepared = await prepareCreateDataSetAndAddPieces(client, {
        payee: ADDRESSES.client1,
        pieces: [{ pieceCid }],
      })
      const commit: Commit = JSON.parse(JSON.stringify(prepared))
      const result = await submitCommit(client, { serviceURL: 'http://pdp.local', commit })

      assert.strictEqual(body?.recordKeeper, Chains.calibration.contracts.fwss.address)
      assert.strictEqual(body?.extraData, prepared.extraData)
      assert.deepStrictEqual(
        body?.pieces.map((piece) => piece.pieceCid),
        [pieceCid.toString()]
      )
      assert.deepStrictEqual(result, { txHash: mockTxHash, extraData: prepared.extraData, pieceCount: 1 })
    })

    it('rejects a malformed commit before sending any request', async () => {
      let requests = 0
      server.use(
        http.post('http://pdp.local/*', () => {
          requests++
          return new HttpResponse(null, { status: 500 })
        })
      )
      const addCommit = await prepareAddPieces(client, { dataSetId: 1n, clientDataSetId: 1n, pieces: [{ pieceCid }] })
      const createCommit = await prepareCreateDataSetAndAddPieces(client, {
        payee: ADDRESSES.client1,
        pieces: [{ pieceCid }],
      })
      const { kind: _kind, ...withoutKind } = addCommit
      const malformed: unknown[] = [
        { ...addCommit, kind: 'addpieces' },
        withoutKind,
        { ...addCommit, extraData: 'nope' },
        { ...addCommit, dataSetId: 'abc' },
        { ...addCommit, nonce: '1.5' },
        { ...addCommit, pieces: [] },
        { ...addCommit, pieces: [{ pieceCid: 'not-a-cid' }] },
        { ...createCommit, cdn: 'yes' },
        { ...createCommit, payee: '0x1234' },
        { ...createCommit, metadata: { project: 1 } },
      ]

      for (const commit of malformed) {
        try {
          await submitCommit(client, { serviceURL: 'http://pdp.local', commit: commit as Commit })
          assert.fail(`should have thrown for ${JSON.stringify(commit)}`)
        } catch (error) {
          assert.isTrue(ZodValidationError.is(error), `expected ZodValidationError for ${JSON.stringify(commit)}`)
        }
      }
      assert.strictEqual(requests, 0)
    })

    it('throws when the signal is already aborted', async () => {
      const commit = await prepareAddPieces(client, { dataSetId: 1n, clientDataSetId: 1n, pieces: [{ pieceCid }] })
      try {
        await submitCommit(client, { serviceURL: 'http://pdp.local', commit, signal: AbortSignal.abort() })
        assert.fail('should have thrown')
      } catch (error) {
        assert.strictEqual((error as Error).name, 'AbortError')
      }
    })
  })
})
