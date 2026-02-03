import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { delay, HttpResponse, http } from 'msw'
import { createWalletClient, decodeAbiParameters, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Chains from '../src/chains.ts'
import {
  AddPiecesError,
  CreateDataSetError,
  DeletePieceError,
  DownloadPieceError,
  FindPieceError,
  GetDataSetError,
  InvalidUploadSizeError,
  LocationHeaderError,
  PostPieceError,
  UploadPieceError,
  WaitDataSetCreationStatusError,
  WaitForAddPiecesStatusError,
} from '../src/errors/pdp.ts'
import { ADDRESSES, PRIVATE_KEYS } from '../src/mocks/index.ts'
import {
  createAndAddPiecesHandler,
  finalizePieceUploadHandler,
  findPieceHandler,
  postPieceHandler,
  postPieceUploadsHandler,
  uploadPieceHandler,
  uploadPieceStreamingHandler,
} from '../src/mocks/pdp.ts'
import * as Piece from '../src/piece.ts'
import * as SP from '../src/sp.ts'
import * as TypedData from '../src/typed-data/index.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'

const account = privateKeyToAccount(PRIVATE_KEYS.key1)
const client = createWalletClient({
  account,
  chain: Chains.calibration,
  transport: viemHttp(),
})

describe('SP', () => {
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

  describe('createDataSet', () => {
    it('should handle dataset creation', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      server.use(
        http.post<never, SP.createDataSet.RequestBody>('http://pdp.local/pdp/data-sets', async ({ request }) => {
          const body = await request.json()
          assert.strictEqual(body.extraData, extraData)
          assert.strictEqual(body.recordKeeper, ADDRESSES.calibration.warmStorage)

          const decoded = decodeAbiParameters(TypedData.signCreateDataSetAbiParameters, body.extraData)
          assert.strictEqual(decoded[0], client.account.address)
          assert.strictEqual(decoded[1], 0n)
          assert.deepStrictEqual(decoded[2], [])
          assert.deepStrictEqual(decoded[3], [])
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/created/${mockTxHash}` },
          })
        })
      )
      const extraData = await TypedData.signCreateDataSet(client, {
        clientDataSetId: 0n,
        payee: ADDRESSES.client1,
      })
      const result = await SP.createDataSet({
        endpoint: 'http://pdp.local',
        recordKeeper: ADDRESSES.calibration.warmStorage,
        extraData,
      })
      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl, mockTxHash)
    })

    it('should handle dataset creation with metadata', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      server.use(
        http.post<never, SP.createDataSet.RequestBody>('http://pdp.local/pdp/data-sets', async ({ request }) => {
          const body = await request.json()
          assert.strictEqual(body.extraData, extraData)
          assert.strictEqual(body.recordKeeper, ADDRESSES.calibration.warmStorage)

          const decoded = decodeAbiParameters(TypedData.signCreateDataSetAbiParameters, body.extraData)
          assert.strictEqual(decoded[0], client.account.address)
          assert.strictEqual(decoded[1], 0n)
          assert.deepStrictEqual(decoded[2], ['name'])
          assert.deepStrictEqual(decoded[3], ['test'])
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/created/${mockTxHash}` },
          })
        })
      )
      const extraData = await TypedData.signCreateDataSet(client, {
        clientDataSetId: 0n,
        payee: ADDRESSES.client1,
        metadata: [{ key: 'name', value: 'test' }],
      })
      const result = await SP.createDataSet({
        endpoint: 'http://pdp.local',
        recordKeeper: ADDRESSES.calibration.warmStorage,
        extraData,
      })
      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl, mockTxHash)
    })

    it('should fail with bad location header', async () => {
      server.use(
        http.post<never, SP.createDataSet.RequestBody>('http://pdp.local/pdp/data-sets', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/created/invalid-hash` },
          })
        })
      )
      const extraData = await TypedData.signCreateDataSet(client, {
        clientDataSetId: 0n,
        payee: ADDRESSES.client1,
      })
      try {
        await SP.createDataSet({
          endpoint: 'http://pdp.local',
          recordKeeper: ADDRESSES.calibration.warmStorage,
          extraData,
        })
        assert.fail('Should have thrown error for bad location header')
      } catch (e) {
        const error = e as SP.createDataSet.ErrorType
        assert.instanceOf(error, LocationHeaderError)
        assert.equal(error.message, 'Location header format is invalid: /pdp/data-sets/created/invalid-hash')
      }
    })

    it('should fail with no location header', async () => {
      server.use(
        http.post<never, SP.createDataSet.RequestBody>('http://pdp.local/pdp/data-sets', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: {},
          })
        })
      )
      const extraData = await TypedData.signCreateDataSet(client, {
        clientDataSetId: 0n,
        payee: ADDRESSES.client1,
      })
      try {
        await SP.createDataSet({
          endpoint: 'http://pdp.local',
          recordKeeper: ADDRESSES.calibration.warmStorage,
          extraData,
        })
        assert.fail('Should have thrown error for no Location header')
      } catch (e) {
        const error = e as SP.createDataSet.ErrorType
        assert.instanceOf(error, LocationHeaderError)
        assert.equal(error.message, 'Location header format is invalid: <none>')
      }
    })

    it('should fail with CreateDataSetError - string error', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return HttpResponse.text(
            `Failed to send transaction: failed to estimate gas: message execution failed (exit=[33], revert reason=[message failed with backtrace:
00: f0169791 (method 3844450837) -- contract reverted at 75 (33)
01: f0169791 (method 6) -- contract reverted at 4535 (33)
02: f0169800 (method 3844450837) -- contract reverted at 75 (33)
03: f0169800 (method 6) -- contract reverted at 10988 (33)
04: f0169792 (method 3844450837) -- contract reverted at 1775 (33)
 (RetCode=33)], vm error=[Error(invariant failure: insufficient funds to cover lockup after function execution)])
`,
            {
              status: 500,
            }
          )
        })
      )
      try {
        await SP.createDataSet({
          endpoint: 'http://pdp.local',
          recordKeeper: ADDRESSES.calibration.warmStorage,
          extraData: await TypedData.signCreateDataSet(client, {
            clientDataSetId: 0n,
            payee: ADDRESSES.client1,
          }),
        })
        assert.fail('Should have thrown error for CreateDataSetError error')
      } catch (e) {
        const error = e as SP.createDataSet.ErrorType
        assert.instanceOf(error, CreateDataSetError)
        assert.equal(error.shortMessage, 'Failed to create data set.')
        assert.equal(
          error.message,
          `Failed to create data set.

Details: 
invariant failure: insufficient funds to cover lockup after function execution`
        )
      }
    })

    it('should fail with CreateDataSetError - typed error', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return HttpResponse.text(
            `Failed to send transaction: failed to estimate gas: message execution failed (exit=[33], revert reason=[message failed with backtrace:
00: f0169791 (method 3844450837) -- contract reverted at 75 (33)
01: f0169791 (method 6) -- contract reverted at 4535 (33)
02: f0169800 (method 3844450837) -- contract reverted at 75 (33)
03: f0169800 (method 6) -- contract reverted at 18957 (33)
 (RetCode=33)], vm error=[0x42d750dc0000000000000000000000007e4abd63a7c8314cc28d388303472353d884f292000000000000000000000000b0ff6622d99a325151642386f65ab33a08c30213])
`,
            {
              status: 500,
            }
          )
        })
      )
      try {
        await SP.createDataSet({
          endpoint: 'http://pdp.local',
          recordKeeper: ADDRESSES.calibration.warmStorage,
          extraData: await TypedData.signCreateDataSet(client, {
            clientDataSetId: 0n,
            payee: ADDRESSES.client1,
          }),
        })
        assert.fail('Should have thrown error for CreateDataSetError error')
      } catch (error) {
        assert.instanceOf(error, CreateDataSetError)
        assert.equal(error.shortMessage, 'Failed to create data set.')
        assert.equal(
          error.message,
          `Failed to create data set.

Details: Warm Storage
InvalidSignature(address expected, address actual)
                (0x7e4ABd63A7C8314Cc28D388303472353D884f292, 0xb0fF6622D99A325151642386F65AB33a08c30213)`
        )
      }
    })

    it('should fail with CreateDataSetError - reversed typed error', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return HttpResponse.text(
            `Failed to send transaction: failed to estimate gas: message execution failed (exit=[33], vm error=[message failed with backtrace:
00: f0169791 (method 3844450837) -- contract reverted at 75 (33)
01: f0169791 (method 6) -- contract reverted at 4535 (33)
02: f0169800 (method 3844450837) -- contract reverted at 75 (33)
03: f0169800 (method 6) -- contract reverted at 18957 (33)
(RetCode=33)], revert reason=[0x42d750dc0000000000000000000000007e4abd63a7c8314cc28d388303472353d884f292000000000000000000000000b0ff6622d99a325151642386f65ab33a08c30213])
`,
            {
              status: 500,
            }
          )
        })
      )
      try {
        await SP.createDataSet({
          endpoint: 'http://pdp.local',
          recordKeeper: ADDRESSES.calibration.warmStorage,
          extraData: await TypedData.signCreateDataSet(client, {
            clientDataSetId: 0n,
            payee: ADDRESSES.client1,
          }),
        })
        assert.fail('Should have thrown error for CreateDataSetError error')
      } catch (error) {
        assert.instanceOf(error, CreateDataSetError)
        assert.equal(error.shortMessage, 'Failed to create data set.')
        assert.equal(
          error.message,
          `Failed to create data set.

Details: Warm Storage
InvalidSignature(address expected, address actual)
                (0x7e4ABd63A7C8314Cc28D388303472353D884f292, 0xb0fF6622D99A325151642386F65AB33a08c30213)`
        )
      }
    })
  })

  describe('waitForDataSetCreationStatus', () => {
    it('should handle successful status check', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockResponse: SP.DataSetCreateSuccess = {
        createMessageHash: mockTxHash,
        dataSetCreated: true,
        service: 'test-service',
        txStatus: 'confirmed',
        ok: true,
        dataSetId: 123,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/created/:tx', ({ params }) => {
          assert.strictEqual(params.tx, mockTxHash)
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const result = await SP.waitForDataSetCreationStatus({
        statusUrl: `http://pdp.local/pdp/data-sets/created/${mockTxHash}`,
      })
      assert.deepStrictEqual(result, mockResponse)
    })

    it('should handle pending then confirmed status', async () => {
      SP.setDelayTime(50)
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      let callCount = 0

      const pendingResponse: SP.DataSetCreatedResponse = {
        createMessageHash: mockTxHash,
        dataSetCreated: false,
        service: 'test-service',
        txStatus: 'pending',
        ok: false,
      }

      const confirmedResponse: SP.DataSetCreateSuccess = {
        createMessageHash: mockTxHash,
        dataSetCreated: true,
        service: 'test-service',
        txStatus: 'confirmed',
        ok: true,
        dataSetId: 123,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/created/:tx', () => {
          callCount++
          if (callCount === 1) {
            return HttpResponse.json(pendingResponse, { status: 200 })
          }
          return HttpResponse.json(confirmedResponse, { status: 200 })
        })
      )

      const result = await SP.waitForDataSetCreationStatus({
        statusUrl: `http://pdp.local/pdp/data-sets/created/${mockTxHash}`,
      })
      assert.strictEqual(result.dataSetCreated, true)
      assert.strictEqual(result.dataSetId, 123)
      assert.isTrue(callCount >= 2, 'Should have polled at least twice')
      SP.resetDelayTime()
    })

    it('should handle server errors', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      server.use(
        http.get('http://pdp.local/pdp/data-sets/created/:tx', () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await SP.waitForDataSetCreationStatus({
          statusUrl: `http://pdp.local/pdp/data-sets/created/${mockTxHash}`,
        })
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.instanceOf(error, WaitDataSetCreationStatusError)
        assert.include(error.message, 'Failed to wait for data set creation status')
      }
    })

    it('should handle timeout', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockResponse: SP.DataSetCreateSuccess = {
        createMessageHash: mockTxHash,
        dataSetCreated: true,
        service: 'test-service',
        txStatus: 'confirmed',
        ok: true,
        dataSetId: 123,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/created/:tx', async () => {
          await delay(150)
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      SP.setTimeout(50)

      try {
        await SP.waitForDataSetCreationStatus({
          statusUrl: `http://pdp.local/pdp/data-sets/created/${mockTxHash}`,
        })
        assert.fail('Should have thrown timeout error')
      } catch (error) {
        assert.instanceOf(error, SP.TimeoutError)
        assert.include(error.message, 'Request timed out after 50ms')
      } finally {
        SP.resetTimeout()
      }
    })
  })

  describe('createDataSetAndAddPieces', () => {
    it('should handle successful data set creation', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const pieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
      server.use(createAndAddPiecesHandler(mockTxHash))

      const result = await SP.createDataSetAndAddPieces({
        endpoint: 'http://pdp.local',
        recordKeeper: ADDRESSES.calibration.warmStorage,
        pieces: [Piece.parse(pieceCid)],
        extraData: await TypedData.signCreateDataSetAndAddPieces(client, {
          clientDataSetId: 0n,
          payee: ADDRESSES.client1,
          pieces: [{ pieceCid: Piece.parse(pieceCid) }],
        }),
      })
      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl, mockTxHash)
    })
  })

  describe('addPieces', () => {
    const validPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

    it('should handle successful piece addition', async () => {
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const pieceCid = Piece.parse(validPieceCid)

      server.use(
        http.post<{ id: string }, SP.addPieces.RequestBody>(
          'http://pdp.local/pdp/data-sets/:id/pieces',
          async ({ request, params }) => {
            const body = await request.json()
            assert.isDefined(body.pieces)
            assert.isDefined(body.extraData)
            const decoded = decodeAbiParameters(TypedData.signAddPiecesAbiParameters, body.extraData)
            assert.strictEqual(decoded[0], 1n)
            assert.deepStrictEqual(decoded[1], [[]])
            assert.deepStrictEqual(decoded[2], [[]])
            assert.strictEqual(body.pieces.length, 1)
            assert.strictEqual(body.pieces[0].pieceCid, validPieceCid)
            assert.strictEqual(body.pieces[0].subPieces.length, 1)
            assert.strictEqual(body.pieces[0].subPieces[0].subPieceCid, validPieceCid)
            return new HttpResponse(null, {
              status: 201,
              headers: {
                Location: `/pdp/data-sets/${params.id}/pieces/added/${mockTxHash}`,
              },
            })
          }
        )
      )

      const extraData = await TypedData.signAddPieces(client, {
        nonce: 1n,
        clientDataSetId: 0n,
        pieces: [{ pieceCid }],
      })

      const result = await SP.addPieces({
        endpoint: 'http://pdp.local',
        dataSetId: 1n,
        pieces: [pieceCid],
        extraData,
      })

      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl, mockTxHash)
      assert.include(result.statusUrl, '/pdp/data-sets/1/pieces/added/')
    })

    it('should handle server errors appropriately', async () => {
      const pieceCid = Piece.parse(validPieceCid)

      server.use(
        http.post('http://pdp.local/pdp/data-sets/:id/pieces', () => {
          return HttpResponse.text('Invalid piece CID', {
            status: 400,
            statusText: 'Bad Request',
          })
        })
      )

      const extraData = await TypedData.signAddPieces(client, {
        clientDataSetId: 0n,
        pieces: [{ pieceCid }],
      })

      try {
        await SP.addPieces({
          endpoint: 'http://pdp.local',
          dataSetId: 1n,
          pieces: [pieceCid],
          extraData,
        })
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.instanceOf(error, AddPiecesError)
        assert.equal(error.shortMessage, 'Failed to add pieces.')
        assert.include(error.message, 'Invalid piece CID')
      }
    })

    it('should handle multiple pieces', async () => {
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const pieceCid1 = Piece.parse(validPieceCid)
      const pieceCid2 = Piece.parse(validPieceCid)

      server.use(
        http.post<{ id: string }, SP.addPieces.RequestBody>(
          'http://pdp.local/pdp/data-sets/:id/pieces',
          async ({ request, params }) => {
            const body = await request.json()
            assert.strictEqual(body.pieces.length, 2)
            assert.strictEqual(body.pieces[0].subPieces.length, 1)
            assert.strictEqual(body.pieces[1].subPieces.length, 1)
            assert.strictEqual(body.pieces[0].pieceCid, body.pieces[0].subPieces[0].subPieceCid)
            assert.strictEqual(body.pieces[1].pieceCid, body.pieces[1].subPieces[0].subPieceCid)

            return new HttpResponse(null, {
              status: 201,
              headers: {
                Location: `/pdp/data-sets/${params.id}/pieces/added/${mockTxHash}`,
              },
            })
          }
        )
      )

      const extraData = await TypedData.signAddPieces(client, {
        clientDataSetId: 0n,
        pieces: [{ pieceCid: pieceCid1 }, { pieceCid: pieceCid2 }],
      })

      const result = await SP.addPieces({
        endpoint: 'http://pdp.local',
        dataSetId: 1n,
        pieces: [pieceCid1, pieceCid2],
        extraData,
      })

      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl, mockTxHash)
    })

    it('should fail with bad location header', async () => {
      const pieceCid = Piece.parse(validPieceCid)

      server.use(
        http.post('http://pdp.local/pdp/data-sets/:id/pieces', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/1/pieces/added/invalid-hash` },
          })
        })
      )

      const extraData = await TypedData.signAddPieces(client, {
        clientDataSetId: 0n,
        pieces: [{ pieceCid }],
      })

      try {
        await SP.addPieces({
          endpoint: 'http://pdp.local',
          dataSetId: 1n,
          pieces: [pieceCid],
          extraData,
        })
        assert.fail('Should have thrown error for bad location header')
      } catch (error) {
        assert.instanceOf(error, LocationHeaderError)
        assert.include(error.message, 'Location header format is invalid')
      }
    })

    it('should fail with no location header', async () => {
      const pieceCid = Piece.parse(validPieceCid)

      server.use(
        http.post('http://pdp.local/pdp/data-sets/:id/pieces', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: {},
          })
        })
      )

      const extraData = await TypedData.signAddPieces(client, {
        clientDataSetId: 0n,
        pieces: [{ pieceCid }],
      })

      try {
        await SP.addPieces({
          endpoint: 'http://pdp.local',
          dataSetId: 1n,
          pieces: [pieceCid],
          extraData,
        })
        assert.fail('Should have thrown error for no location header')
      } catch (error) {
        assert.instanceOf(error, LocationHeaderError)
        assert.include(error.message, 'Location header format is invalid: <none>')
      }
    })
  })

  describe('waitForAddPiecesStatus', () => {
    it('should handle successful status check', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      const mockResponse: SP.AddPiecesSuccess = {
        txHash: mockTxHash,
        txStatus: 'confirmed',
        dataSetId: 1,
        pieceCount: 2,
        addMessageOk: true,
        confirmedPieceIds: [101, 102],
        piecesAdded: true,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/:id/pieces/added/:txHash', ({ params }) => {
          assert.strictEqual(params.id, '1')
          assert.strictEqual(params.txHash, mockTxHash)

          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const result = await SP.waitForAddPiecesStatus({
        statusUrl: `http://pdp.local/pdp/data-sets/1/pieces/added/${mockTxHash}`,
      })
      assert.deepStrictEqual(result, mockResponse)
    })

    it('should handle pending then confirmed status', async () => {
      SP.setDelayTime(50)

      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      let callCount = 0

      const pendingResponse: SP.AddPiecesResponse = {
        txHash: mockTxHash,
        txStatus: 'pending',
        dataSetId: 1,
        pieceCount: 2,
        addMessageOk: null,
        piecesAdded: false,
      }

      const confirmedResponse: SP.AddPiecesSuccess = {
        txHash: mockTxHash,
        txStatus: 'confirmed',
        dataSetId: 1,
        pieceCount: 2,
        addMessageOk: true,
        confirmedPieceIds: [101, 102],
        piecesAdded: true,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/:id/pieces/added/:txHash', () => {
          callCount++
          // First call returns pending, subsequent calls return confirmed
          if (callCount === 1) {
            return HttpResponse.json(pendingResponse, { status: 200 })
          }
          return HttpResponse.json(confirmedResponse, { status: 200 })
        })
      )

      const result = await SP.waitForAddPiecesStatus({
        statusUrl: `http://pdp.local/pdp/data-sets/1/pieces/added/${mockTxHash}`,
      })
      assert.strictEqual(result.txStatus, 'confirmed')
      assert.strictEqual(result.piecesAdded, true)
      assert.deepStrictEqual(result.confirmedPieceIds, [101, 102])
      assert.isTrue(callCount >= 2, 'Should have polled at least twice')
      SP.resetDelayTime()
    })

    it('should handle server errors', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      server.use(
        http.get('http://pdp.local/pdp/data-sets/:id/pieces/added/:txHash', () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await SP.waitForAddPiecesStatus({
          statusUrl: `http://pdp.local/pdp/data-sets/1/pieces/added/${mockTxHash}`,
        })
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.instanceOf(error, WaitForAddPiecesStatusError)
        assert.include(error.message, 'Failed to wait for add pieces status')
      }
    })

    it('should handle timeout status check', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      const mockResponse: SP.AddPiecesSuccess = {
        txHash: mockTxHash,
        txStatus: 'confirmed',
        dataSetId: 1,
        pieceCount: 2,
        addMessageOk: true,
        confirmedPieceIds: [101, 102],
        piecesAdded: true,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/:id/pieces/added/:txHash', async ({ params }) => {
          assert.strictEqual(params.id, '1')
          assert.strictEqual(params.txHash, mockTxHash)

          await delay(150)
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      SP.setTimeout(50)

      try {
        const result = await SP.waitForAddPiecesStatus({
          statusUrl: `http://pdp.local/pdp/data-sets/1/pieces/added/${mockTxHash}`,
        })
        assert.deepStrictEqual(result, mockResponse)
      } catch (error) {
        assert.instanceOf(error, SP.TimeoutError)
        assert.include(error.message, 'Request timed out after 50ms')
      } finally {
        SP.resetTimeout()
      }
    })
  })

  describe('deletePiece', () => {
    it('should handle successful delete', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockResponse = {
        txHash: mockTxHash,
      }

      server.use(
        http.delete('http://pdp.local/pdp/data-sets/1/pieces/2', async ({ request }) => {
          const body = (await request.json()) as { extraData: string }
          assert.hasAllKeys(body, ['extraData'])
          assert.isDefined(body.extraData)
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const extraData = await TypedData.signSchedulePieceRemovals(client, {
        clientDataSetId: 0n,
        pieceIds: [2n],
      })

      const result = await SP.deletePiece({
        endpoint: 'http://pdp.local',
        dataSetId: 1n,
        pieceId: 2n,
        extraData,
      })

      assert.strictEqual(result.txHash, mockTxHash)
    })

    it('should handle server errors', async () => {
      server.use(
        http.delete('http://pdp.local/pdp/data-sets/1/pieces/2', async () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      const extraData = await TypedData.signSchedulePieceRemovals(client, {
        clientDataSetId: 0n,
        pieceIds: [2n],
      })

      try {
        await SP.deletePiece({
          endpoint: 'http://pdp.local',
          dataSetId: 1n,
          pieceId: 2n,
          extraData,
        })
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.instanceOf(error, DeletePieceError)
        assert.equal(error.shortMessage, 'Failed to delete piece.')
        assert.include(error.message, 'Database error')
      }
    })
  })

  describe('deletePieces', () => {
    it('should handle successful batch delete', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockResponse = {
        txHash: mockTxHash,
      }

      server.use(
        http.post('http://pdp.local/pdp/data-sets/1/pieces/removals', async ({ request }) => {
          const body = (await request.json()) as { pieceIds: string[]; extraData: string }
          assert.hasAllKeys(body, ['pieceIds', 'extraData'])
          assert.deepStrictEqual(body.pieceIds, ['2', '3'])
          assert.isDefined(body.extraData)
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const extraData = await TypedData.signSchedulePieceRemovals(client, {
        clientDataSetId: 0n,
        pieceIds: [2n, 3n],
      })

      const result = await SP.deletePieces({
        endpoint: 'http://pdp.local',
        dataSetId: 1n,
        pieceIds: [2n, 3n],
        extraData,
      })

      assert.strictEqual(result.txHash, mockTxHash)
    })
  })

  describe('findPiece', () => {
    const mockPieceCidStr = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

    it('should find a piece successfully', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)

      server.use(findPieceHandler(mockPieceCidStr, true))

      const result = await SP.findPiece({
        endpoint: 'http://pdp.local',
        pieceCid,
      })
      assert.strictEqual(result.toString(), mockPieceCidStr)
    })

    it('should handle piece not found (timeout)', async () => {
      SP.setTimeout(50)
      const pieceCid = Piece.parse(mockPieceCidStr)

      server.use(findPieceHandler(mockPieceCidStr, false))

      try {
        await SP.findPiece({
          endpoint: 'http://pdp.local',
          pieceCid,
          retry: true,
        })
        assert.fail('Should have thrown error for not found')
      } catch (error) {
        assert.instanceOf(error, FindPieceError)
        assert.equal(error.shortMessage, 'Failed to find piece.')
        assert.include(error.message, 'Timeout waiting for piece to be found')
      } finally {
        SP.resetTimeout()
      }
    })

    it('should handle server errors', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)

      server.use(
        http.get('http://pdp.local/pdp/piece', () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await SP.findPiece({
          endpoint: 'http://pdp.local',
          pieceCid,
        })
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.instanceOf(error, FindPieceError)
        assert.equal(error.shortMessage, 'Failed to find piece.')
        assert.include(error.message, 'Database error')
      }
    })

    it('should retry on 202 status and eventually succeed', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      let attemptCount = 0

      server.use(
        http.get('http://pdp.local/pdp/piece', () => {
          attemptCount++
          // Return 202 for first 2 attempts, then 200
          if (attemptCount < 3) {
            return HttpResponse.json({ message: 'Processing' }, { status: 202 })
          }
          return HttpResponse.json({ pieceCid: mockPieceCidStr }, { status: 200 })
        })
      )

      const result = await SP.findPiece({
        endpoint: 'http://pdp.local',
        pieceCid,
        retry: true,
      })
      assert.strictEqual(result.toString(), mockPieceCidStr)
      assert.isAtLeast(attemptCount, 3, 'Should have retried at least 3 times')
    })
  })

  describe('uploadPiece', () => {
    const mockPieceCidStr = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
    const mockUuid = '12345678-1234-1234-1234-123456789012'

    // Create valid test data (minimum 127 bytes)
    function createTestData(size: number): Uint8Array {
      return new Uint8Array(size).fill(0x42)
    }

    it('should upload a piece successfully', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = createTestData(SIZE_CONSTANTS.MIN_UPLOAD_SIZE)

      server.use(postPieceHandler(mockPieceCidStr, mockUuid), uploadPieceHandler(mockUuid))

      // Should not throw
      await SP.uploadPiece({
        endpoint: 'http://pdp.local',
        data: testData,
        pieceCid,
      })
    })

    it('should handle piece already exists', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = createTestData(SIZE_CONSTANTS.MIN_UPLOAD_SIZE)

      // postPieceHandler without uuid returns 200 (piece exists)
      server.use(postPieceHandler(mockPieceCidStr))

      // Should not throw - early return when piece exists
      await SP.uploadPiece({
        endpoint: 'http://pdp.local',
        data: testData,
        pieceCid,
      })
    })

    it('should fail with size too small', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = createTestData(SIZE_CONSTANTS.MIN_UPLOAD_SIZE - 1)

      try {
        await SP.uploadPiece({
          endpoint: 'http://pdp.local',
          data: testData,
          pieceCid,
        })
        assert.fail('Should have thrown error for size too small')
      } catch (error) {
        assert.instanceOf(error, InvalidUploadSizeError)
        assert.include(error.message, 'Invalid upload size')
      }
    })

    it('should fail with size too large', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      // Create a typed array descriptor without actually allocating the memory
      const testData = { length: SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1 } as Uint8Array

      try {
        await SP.uploadPiece({
          endpoint: 'http://pdp.local',
          data: testData,
          pieceCid,
        })
        assert.fail('Should have thrown error for size too large')
      } catch (error) {
        assert.instanceOf(error, InvalidUploadSizeError)
        assert.include(error.message, 'Invalid upload size')
      }
    })

    it('should fail with invalid Location header', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = createTestData(SIZE_CONSTANTS.MIN_UPLOAD_SIZE)

      server.use(
        http.post('http://pdp.local/pdp/piece', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: {},
          })
        })
      )

      try {
        await SP.uploadPiece({
          endpoint: 'http://pdp.local',
          data: testData,
          pieceCid,
        })
        assert.fail('Should have thrown error for missing Location header')
      } catch (error) {
        assert.instanceOf(error, LocationHeaderError)
        assert.include(error.message, 'Location header format is invalid')
      }
    })

    it('should handle POST errors', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = createTestData(SIZE_CONSTANTS.MIN_UPLOAD_SIZE)

      server.use(
        http.post('http://pdp.local/pdp/piece', () => {
          return HttpResponse.text('Server error', { status: 500 })
        })
      )

      try {
        await SP.uploadPiece({
          endpoint: 'http://pdp.local',
          data: testData,
          pieceCid,
        })
        assert.fail('Should have thrown error for POST error')
      } catch (error) {
        assert.instanceOf(error, PostPieceError)
        assert.include(error.message, 'Failed to create upload session')
      }
    })

    it('should handle PUT errors', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = createTestData(SIZE_CONSTANTS.MIN_UPLOAD_SIZE)

      server.use(
        postPieceHandler(mockPieceCidStr, mockUuid),
        http.put(`http://pdp.local/pdp/piece/upload/${mockUuid}`, () => {
          return HttpResponse.text('Upload failed', { status: 500 })
        })
      )

      try {
        await SP.uploadPiece({
          endpoint: 'http://pdp.local',
          data: testData,
          pieceCid,
        })
        assert.fail('Should have thrown error for PUT error')
      } catch (error) {
        assert.instanceOf(error, UploadPieceError)
        assert.include(error.message, 'Failed to upload piece')
      }
    })
  })

  describe('uploadPieceStreaming', () => {
    const mockPieceCidStr = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
    const mockUuid = '12345678-1234-1234-1234-123456789012'

    // Create async iterable from data
    async function* createAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
      // Yield in chunks
      const chunkSize = 64
      for (let i = 0; i < data.length; i += chunkSize) {
        yield data.slice(i, Math.min(i + chunkSize, data.length))
      }
    }

    it('should upload a piece successfully with provided PieceCID', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        postPieceUploadsHandler(mockUuid),
        uploadPieceStreamingHandler(mockUuid),
        finalizePieceUploadHandler(mockUuid, mockPieceCidStr)
      )

      const result = await SP.uploadPieceStreaming({
        endpoint: 'http://pdp.local',
        data: createAsyncIterable(testData),
        pieceCid,
      })

      assert.strictEqual(result.pieceCid.toString(), mockPieceCidStr)
      assert.strictEqual(result.size, testData.length)
    })

    it('should track progress during upload', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(256).fill(0x42)
      const progressCalls: number[] = []

      server.use(
        postPieceUploadsHandler(mockUuid),
        // Custom handler that consumes the stream
        http.put(`http://pdp.local/pdp/piece/uploads/${mockUuid}`, async ({ request }) => {
          // Consume the stream to trigger progress callbacks
          const body = await request.arrayBuffer()
          assert.strictEqual(body.byteLength, testData.length)
          return HttpResponse.text('No Content', { status: 204 })
        }),
        finalizePieceUploadHandler(mockUuid, mockPieceCidStr)
      )

      const result = await SP.uploadPieceStreaming({
        endpoint: 'http://pdp.local',
        data: createAsyncIterable(testData),
        pieceCid,
        onProgress: (bytes) => progressCalls.push(bytes),
      })

      assert.strictEqual(result.size, testData.length)
      assert.isAbove(progressCalls.length, 0, 'Should have received progress callbacks')
      // Last progress call should equal total size
      assert.strictEqual(progressCalls[progressCalls.length - 1], testData.length)
    })

    it('should fail when session creation returns error', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        http.post('http://pdp.local/pdp/piece/uploads', () => {
          return HttpResponse.text('Server error', { status: 500 })
        })
      )

      try {
        await SP.uploadPieceStreaming({
          endpoint: 'http://pdp.local',
          data: createAsyncIterable(testData),
          pieceCid,
        })
        assert.fail('Should have thrown error for session creation failure')
      } catch (error) {
        assert.instanceOf(error, PostPieceError)
        assert.include(error.message, 'Failed to create upload session')
      }
    })

    it('should fail when session creation returns wrong status', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        http.post('http://pdp.local/pdp/piece/uploads', () => {
          return HttpResponse.text('OK', { status: 200 })
        })
      )

      try {
        await SP.uploadPieceStreaming({
          endpoint: 'http://pdp.local',
          data: createAsyncIterable(testData),
          pieceCid,
        })
        assert.fail('Should have thrown error for wrong status')
      } catch (error) {
        assert.instanceOf(error, PostPieceError)
        assert.include(error.message, 'Expected 201 Created')
      }
    })

    it('should fail with missing Location header', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        http.post('http://pdp.local/pdp/piece/uploads', () => {
          return new HttpResponse(null, { status: 201 })
        })
      )

      try {
        await SP.uploadPieceStreaming({
          endpoint: 'http://pdp.local',
          data: createAsyncIterable(testData),
          pieceCid,
        })
        assert.fail('Should have thrown error for missing Location header')
      } catch (error) {
        assert.instanceOf(error, LocationHeaderError)
        assert.include(error.message, 'Location header missing')
      }
    })

    it('should fail with invalid Location header format', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        http.post('http://pdp.local/pdp/piece/uploads', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: '/invalid/path' },
          })
        })
      )

      try {
        await SP.uploadPieceStreaming({
          endpoint: 'http://pdp.local',
          data: createAsyncIterable(testData),
          pieceCid,
        })
        assert.fail('Should have thrown error for invalid Location header')
      } catch (error) {
        assert.instanceOf(error, LocationHeaderError)
        assert.include(error.message, 'Invalid Location header format')
      }
    })

    it('should fail when PUT upload returns error', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        postPieceUploadsHandler(mockUuid),
        http.put(`http://pdp.local/pdp/piece/uploads/${mockUuid}`, () => {
          return HttpResponse.text('Upload failed', { status: 500 })
        })
      )

      try {
        await SP.uploadPieceStreaming({
          endpoint: 'http://pdp.local',
          data: createAsyncIterable(testData),
          pieceCid,
        })
        assert.fail('Should have thrown error for PUT failure')
      } catch (error) {
        assert.instanceOf(error, UploadPieceError)
        assert.include(error.message, 'Failed to upload piece')
      }
    })

    it('should fail when PUT upload returns wrong status', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        postPieceUploadsHandler(mockUuid),
        http.put(`http://pdp.local/pdp/piece/uploads/${mockUuid}`, () => {
          return HttpResponse.text('OK', { status: 200 })
        })
      )

      try {
        await SP.uploadPieceStreaming({
          endpoint: 'http://pdp.local',
          data: createAsyncIterable(testData),
          pieceCid,
        })
        assert.fail('Should have thrown error for wrong PUT status')
      } catch (error) {
        assert.instanceOf(error, UploadPieceError)
        assert.include(error.message, 'Expected 204 No Content')
      }
    })

    it('should fail when finalize returns error', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        postPieceUploadsHandler(mockUuid),
        uploadPieceStreamingHandler(mockUuid),
        http.post(`http://pdp.local/pdp/piece/uploads/${mockUuid}`, () => {
          return HttpResponse.text('Finalize failed', { status: 500 })
        })
      )

      try {
        await SP.uploadPieceStreaming({
          endpoint: 'http://pdp.local',
          data: createAsyncIterable(testData),
          pieceCid,
        })
        assert.fail('Should have thrown error for finalize failure')
      } catch (error) {
        assert.instanceOf(error, PostPieceError)
        assert.include(error.message, 'Failed to finalize upload')
      }
    })

    it('should fail when finalize returns wrong status', async () => {
      const pieceCid = Piece.parse(mockPieceCidStr)
      const testData = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)

      server.use(
        postPieceUploadsHandler(mockUuid),
        uploadPieceStreamingHandler(mockUuid),
        http.post(`http://pdp.local/pdp/piece/uploads/${mockUuid}`, () => {
          return HttpResponse.text('Created', { status: 201 })
        })
      )

      try {
        await SP.uploadPieceStreaming({
          endpoint: 'http://pdp.local',
          data: createAsyncIterable(testData),
          pieceCid,
        })
        assert.fail('Should have thrown error for wrong finalize status')
      } catch (error) {
        assert.instanceOf(error, PostPieceError)
        assert.include(error.message, 'Expected 200 OK for finalization')
      }
    })
  })

  describe('getDataSet', () => {
    it('should successfully fetch data set data', async () => {
      const mockDataSetData: SP.getDataSet.ReturnType = {
        id: 292,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0,
          },
          {
            pieceId: 102,
            pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceOffset: 0,
          },
        ],
        nextChallengeEpoch: 1500,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/292', () => {
          return HttpResponse.json(mockDataSetData, {
            status: 200,
          })
        })
      )

      const result = await SP.getDataSet({
        endpoint: 'http://pdp.local',
        dataSetId: 292n,
      })

      assert.equal(result.id, mockDataSetData.id)
      assert.equal(result.nextChallengeEpoch, mockDataSetData.nextChallengeEpoch)
      assert.equal(result.pieces.length, mockDataSetData.pieces.length)
      assert.equal(result.pieces[0].pieceId, mockDataSetData.pieces[0].pieceId)
      assert.equal(result.pieces[0].pieceCid, mockDataSetData.pieces[0].pieceCid)
    })

    it('should handle data set not found', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/999', () => {
          return new HttpResponse(null, {
            status: 404,
          })
        })
      )

      try {
        await SP.getDataSet({
          endpoint: 'http://pdp.local',
          dataSetId: 999n,
        })
        assert.fail('Should have thrown error for not found data set')
      } catch (error) {
        assert.instanceOf(error, GetDataSetError)
        assert.equal(error.shortMessage, 'Data set not found.')
      }
    })

    it('should handle server errors', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/292', () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await SP.getDataSet({
          endpoint: 'http://pdp.local',
          dataSetId: 292n,
        })
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.instanceOf(error, GetDataSetError)
        assert.equal(error.shortMessage, 'Failed to get data set.')
        assert.include(error.message, 'Database error')
      }
    })

    it('should handle data set with no pieces', async () => {
      const emptyDataSetData: SP.getDataSet.ReturnType = {
        id: 292,
        pieces: [],
        nextChallengeEpoch: 1500,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/292', () => {
          return HttpResponse.json(emptyDataSetData, {
            status: 200,
          })
        })
      )

      const result = await SP.getDataSet({
        endpoint: 'http://pdp.local',
        dataSetId: 292n,
      })

      assert.deepStrictEqual(result, emptyDataSetData)
      assert.isArray(result.pieces)
      assert.equal(result.pieces.length, 0)
    })
  })

  describe('downloadPiece', () => {
    it('should successfully download and verify piece', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )

      const result = await SP.downloadPiece({
        endpoint: 'http://pdp.local',
        pieceCid,
      })
      assert.deepEqual(result, testData)
    })

    it('should throw on download failure (404)', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return HttpResponse.text('Not Found', {
            status: 404,
          })
        })
      )

      try {
        await SP.downloadPiece({
          endpoint: 'http://pdp.local',
          pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'Failed to download piece')
      }
    })

    it('should throw on server error (500)', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return HttpResponse.text('Internal Server Error', {
            status: 500,
          })
        })
      )

      try {
        await SP.downloadPiece({
          endpoint: 'http://pdp.local',
          pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'Failed to download piece')
      }
    })

    it('should throw on PieceCID verification failure', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)
      const wrongData = new Uint8Array([9, 9, 9, 9]) // Different data

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return HttpResponse.arrayBuffer(wrongData.buffer)
        })
      )

      try {
        await SP.downloadPiece({
          endpoint: 'http://pdp.local',
          pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        assert.include(error.message, 'PieceCID verification failed')
      }
    })

    it('should handle null response body', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          return new HttpResponse()
        })
      )

      try {
        await SP.downloadPiece({
          endpoint: 'http://pdp.local',
          pieceCid,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, DownloadPieceError)
        // Accept either error message as HttpResponse() behaves differently in Node vs browser
        assert.match(error.message, /Response body is (null|empty)/)
      }
    })

    it('should correctly stream and verify chunked data', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          // Split test data into chunks
          const chunk1 = testData.slice(0, 4)
          const chunk2 = testData.slice(4)

          // Create readable stream that emits chunks
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(chunk1)
              // Small delay to simulate network
              await new Promise((resolve) => setTimeout(resolve, 10))
              controller.enqueue(chunk2)
              controller.close()
            },
          })
          return new HttpResponse(stream, {
            status: 200,
          })
        })
      )

      const result = await SP.downloadPiece({
        endpoint: 'http://pdp.local',
        pieceCid,
      })
      // Verify we got all the data correctly reassembled
      assert.deepEqual(result, testData)
    })

    it('should handle large chunked downloads', async () => {
      // Create larger test data (1KB)
      const testData = new Uint8Array(1024)
      for (let i = 0; i < testData.length; i++) {
        testData[i] = i % 256
      }
      const pieceCid = Piece.calculate(testData)

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', () => {
          // Create readable stream that emits in 128-byte chunks
          const chunkSize = 128
          let offset = 0

          const stream = new ReadableStream({
            async pull(controller) {
              if (offset >= testData.length) {
                controller.close()
                return
              }
              const chunk = testData.slice(offset, Math.min(offset + chunkSize, testData.length))
              offset += chunkSize
              controller.enqueue(chunk)
            },
          })
          return new HttpResponse(stream, { status: 200 })
        })
      )

      const result = await SP.downloadPiece({
        endpoint: 'http://pdp.local',
        pieceCid,
      })
      assert.deepEqual(result, testData)
    })
  })
})
