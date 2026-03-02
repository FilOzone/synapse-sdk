/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import * as SessionKey from '@filoz/synapse-core/session-key'
import * as TypedData from '@filoz/synapse-core/typed-data'
import { assert } from 'chai'

import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createWalletClient, decodeAbiParameters, recoverTypedDataAddress, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Synapse } from '../synapse.ts'

// mock server for testing
const server = setup()

const account = privateKeyToAccount(Mocks.PRIVATE_KEYS.key1)
const client = createWalletClient({
  chain: calibration,
  transport: viemHttp(),
  account,
})

describe('Synapse', () => {
  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })
  beforeEach(() => {
    server.resetHandlers()
  })

  describe('Session Keys', () => {
    const FAKE_TX_HASH = '0x3816d82cb7a6f5cde23f4d63c0763050d13c6b6dc659d0a7e6eba80b0ec76a18'
    beforeEach(() => {
      server.use(Mocks.PING())
    })

    it('should create dataset with session key', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: false,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getApprovedProviders: () => [[1n]],
          },
        }),
        ...Mocks.pdp.streamingUploadHandlers(),
        Mocks.pdp.findAnyPieceHandler(true),
        Mocks.pdp.dataSetCreationStatusHandler(FAKE_TX_HASH, {
          createMessageHash: FAKE_TX_HASH,
          dataSetCreated: true,
          service: 'test-service',
          txStatus: 'confirmed',
          ok: true,
          dataSetId: 123,
        }),
        Mocks.pdp.pieceAdditionStatusHandler(123, FAKE_TX_HASH, {
          txHash: FAKE_TX_HASH,
          txStatus: 'confirmed',
          dataSetId: 123,
          pieceCount: 1,
          addMessageOk: true,
          piecesAdded: true,
          confirmedPieceIds: [0],
        }),
        http.post(`https://pdp.example.com/pdp/data-sets/create-and-add`, async ({ request }) => {
          const body = (await request.json()) as any
          const decoded = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes' }], body.extraData)
          const createDataSetDecoded = decodeAbiParameters(TypedData.signCreateDataSetAbiParameters, decoded[0])

          const actualPayer = createDataSetDecoded[0]
          const clientDataSetId = createDataSetDecoded[1]
          const signature = createDataSetDecoded[4]

          const actualSigner = await recoverTypedDataAddress({
            domain: TypedData.getStorageDomain({ chain: calibration }),
            types: TypedData.EIP712Types,
            primaryType: 'CreateDataSet',
            message: {
              clientDataSetId,
              payee: Mocks.ADDRESSES.serviceProvider1,
              metadata: [],
            },
            signature,
          })

          assert.equal(actualPayer, client.account.address)
          assert.equal(actualSigner, sessionKey.account.address)
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/created/${FAKE_TX_HASH}` },
          })
        })
      )
      const sessionKey = SessionKey.fromSecp256k1({
        chain: calibration,
        privateKey: Mocks.PRIVATE_KEYS.key2,
        root: client.account,
      })
      const synapse = new Synapse({ client, source: null, sessionClient: sessionKey.client })
      const firstData = new Uint8Array(127).fill(1) // 127 bytes
      await synapse.storage.upload(firstData, {
        count: 1,
        providerIds: [1n],
      })
    })

    it('should schedule deletion with session key', async () => {
      const pieceCid = 'bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy'
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: false,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getApprovedProviders: () => [[1n]],
          },
        }),
        http.get(`https://pdp.example.com/pdp/data-sets/:id`, ({ params }) => {
          return HttpResponse.json(
            {
              id: Number(params.id),
              nextChallengeEpoch: 5000,
              pieces: [
                {
                  pieceCid: pieceCid,
                  pieceId: 0,
                  subPieceCid: pieceCid,
                  subPieceOffset: 0,
                },
              ],
            },
            { status: 200 }
          )
        }),
        ...Mocks.pdp.streamingUploadHandlers(),
        Mocks.pdp.findAnyPieceHandler(true),
        Mocks.pdp.dataSetCreationStatusHandler(FAKE_TX_HASH, {
          createMessageHash: FAKE_TX_HASH,
          dataSetCreated: true,
          service: 'test-service',
          txStatus: 'confirmed',
          ok: true,
          dataSetId: 1,
        }),
        Mocks.pdp.pieceAdditionStatusHandler(1, FAKE_TX_HASH, {
          txHash: FAKE_TX_HASH,
          txStatus: 'confirmed',
          dataSetId: 1,
          pieceCount: 1,
          addMessageOk: true,
          piecesAdded: true,
          confirmedPieceIds: [0],
        }),
        http.post(`https://pdp.example.com/pdp/data-sets/create-and-add`, () => {
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/created/${FAKE_TX_HASH}` },
          })
        }),
        http.delete<{ id: string; pieceId: string }>(
          `https://pdp.example.com/pdp/data-sets/:id/pieces/:pieceId`,
          async ({ request }) => {
            const body = (await request.json()) as any
            const decoded = decodeAbiParameters([{ type: 'bytes' }], body.extraData)
            const actualSigner = await recoverTypedDataAddress({
              domain: TypedData.getStorageDomain({ chain: calibration }),
              types: TypedData.EIP712Types,
              primaryType: 'SchedulePieceRemovals',
              message: {
                clientDataSetId: 0n,
                pieceIds: [0n],
              },
              signature: decoded[0],
            })

            assert.equal(actualSigner, sessionKey.account.address)
            return HttpResponse.json(
              {
                txHash: FAKE_TX_HASH,
              },
              { status: 200 }
            )
          }
        )
      )
      const sessionKey = SessionKey.fromSecp256k1({
        chain: calibration,
        privateKey: Mocks.PRIVATE_KEYS.key2,
        root: client.account,
      })
      const synapse = new Synapse({ client, source: null, sessionClient: sessionKey.client })
      const firstData = new Uint8Array(127).fill(1) // 127 bytes
      const context = await synapse.storage.getDefaultContext()
      const result = await context.upload(firstData)

      await context.deletePiece({ piece: result.pieceCid })
    })
  })
})
