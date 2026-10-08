import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { delay, HttpResponse, http } from 'msw'
import { createWalletClient, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Chains from '../src/chains.ts'
import { UploadPieceError } from '../src/errors/pdp.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { findAnyPieceHandler, postPieceHandler, uploadPieceHandler } from '../src/mocks/pdp.ts'
import * as Piece from '../src/piece/index.ts'
import { AbortError } from '../src/sp/index.ts'
import { upload } from '../src/sp/upload.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'

const account = privateKeyToAccount(PRIVATE_KEYS.key1)
const client = createWalletClient({
  account,
  chain: Chains.calibration,
  transport: viemHttp(),
})

const serviceURL = 'https://pdp.example.com'
const mockUuid = '12345678-1234-1234-1234-123456789012'
const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

describe('upload', () => {
  const server = setup()
  const bytes = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x42)
  const file = new File([bytes], 'test.bin', { type: 'application/octet-stream' })
  let pieceCid: Piece.PieceCID

  before(async () => {
    await server.start()
    pieceCid = await Piece.calculate(bytes)
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  function addPiecesHandler(onCall?: () => void) {
    return http.post(`${serviceURL}/pdp/data-sets/:id/pieces`, ({ params }) => {
      onCall?.()
      return new HttpResponse(null, {
        status: 201,
        headers: { Location: `/pdp/data-sets/${params.id}/pieces/added/${mockTxHash}` },
      })
    })
  }

  it('should upload, wait for the piece and add it to the data set', async () => {
    const events: string[] = []
    server.use(
      JSONRPC(presets.basic),
      postPieceHandler(pieceCid.toString(), mockUuid),
      uploadPieceHandler(mockUuid),
      findAnyPieceHandler(true),
      addPiecesHandler()
    )

    const result = await upload(client, {
      dataSetId: 1n,
      data: [file],
      onEvent: (event) => events.push(event),
    })

    assert.strictEqual(result.txHash, mockTxHash)
    assert.strictEqual(result.pieces.length, 1)
    assert.strictEqual(result.pieces[0].pieceCid.toString(), pieceCid.toString())
    assert.deepStrictEqual(result.pieces[0].metadata, { name: 'test.bin', type: 'application/octet-stream' })
    assert.deepStrictEqual(events, ['pieceUploaded', 'pieceParked'])
  })

  it('should abort an in-flight PUT upload', async () => {
    const controller = new AbortController()
    server.use(
      JSONRPC(presets.basic),
      postPieceHandler(pieceCid.toString(), mockUuid),
      http.put(`${serviceURL}/pdp/piece/upload/${mockUuid}`, async () => {
        controller.abort()
        await delay('infinite')
        return new HttpResponse(null, { status: 204 })
      })
    )

    try {
      await upload(client, { dataSetId: 1n, data: [file], signal: controller.signal })
      assert.fail('Should have thrown error for aborted upload')
    } catch (error) {
      assert.instanceOf(error, AbortError)
    }
  })

  it('should abort while waiting for the piece', async () => {
    const controller = new AbortController()
    server.use(
      JSONRPC(presets.basic),
      postPieceHandler(pieceCid.toString(), mockUuid),
      uploadPieceHandler(mockUuid),
      http.get(`${serviceURL}/pdp/piece`, async () => {
        controller.abort()
        await delay('infinite')
        return HttpResponse.json({ pieceCid: pieceCid.toString() })
      })
    )

    try {
      await upload(client, { dataSetId: 1n, data: [file], signal: controller.signal })
      assert.fail('Should have thrown error for aborted piece wait')
    } catch (error) {
      assert.instanceOf(error, AbortError)
    }
  })

  it('should abort before adding pieces', async () => {
    const controller = new AbortController()
    let addPiecesCalled = false
    server.use(
      JSONRPC(presets.basic),
      postPieceHandler(pieceCid.toString(), mockUuid),
      uploadPieceHandler(mockUuid),
      findAnyPieceHandler(true),
      addPiecesHandler(() => {
        addPiecesCalled = true
      })
    )

    try {
      await upload(client, {
        dataSetId: 1n,
        data: [file],
        signal: controller.signal,
        onEvent: (event) => {
          if (event === 'pieceParked') controller.abort()
        },
      })
      assert.fail('Should have thrown error for aborted add pieces')
    } catch (error) {
      assert.instanceOf(error, AbortError)
      assert.isFalse(addPiecesCalled)
    }
  })

  it('should abort sibling uploads when one upload fails', async () => {
    const otherBytes = new Uint8Array(SIZE_CONSTANTS.MIN_UPLOAD_SIZE).fill(0x43)
    const otherFile = new File([otherBytes], 'other.bin', { type: 'application/octet-stream' })
    const failingUuid = '00000000-0000-0000-0000-000000000001'
    const hangingUuid = '00000000-0000-0000-0000-000000000002'
    let hangingAborted = false
    const hangingStarted = Promise.withResolvers<void>()

    server.use(
      JSONRPC(presets.basic),
      http.post<Record<string, never>, { pieceCid: string }>(`${serviceURL}/pdp/piece`, async ({ request }) => {
        const body = await request.json()
        const uuid = body.pieceCid === pieceCid.toString() ? failingUuid : hangingUuid
        return new HttpResponse(null, { status: 201, headers: { Location: `/pdp/piece/upload/${uuid}` } })
      }),
      http.put(`${serviceURL}/pdp/piece/upload/${hangingUuid}`, async ({ request }) => {
        request.signal.addEventListener('abort', () => {
          hangingAborted = true
        })
        hangingStarted.resolve()
        await delay('infinite')
        return new HttpResponse(null, { status: 204 })
      }),
      http.put(`${serviceURL}/pdp/piece/upload/${failingUuid}`, async () => {
        // Fail only once the sibling PUT is in flight
        await hangingStarted.promise
        return HttpResponse.text('upload failed', { status: 500 })
      })
    )

    try {
      await upload(client, { dataSetId: 1n, data: [file, otherFile] })
      assert.fail('Should have thrown error for failed upload')
    } catch (error) {
      assert.instanceOf(error, UploadPieceError)
      assert.include((error as Error).message, 'upload failed')
    }
    assert.isTrue(hangingAborted, 'Sibling upload should have been aborted')
  })
})
