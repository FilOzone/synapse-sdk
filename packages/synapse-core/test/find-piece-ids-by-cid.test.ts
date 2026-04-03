import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, toHex } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { findPieceIdsByCid, findPieceIdsByCidCall } from '../src/pdp-verifier/find-piece-ids-by-cid.ts'
import * as Piece from '../src/piece/piece.ts'

describe('findPieceIdsByCid', () => {
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

  describe('findPieceIdsByCidCall', () => {
    const pieceCid = Piece.parse('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

    it('should create call with calibration chain defaults', () => {
      const call = findPieceIdsByCidCall({
        chain: calibration,
        dataSetId: 1n,
        pieceCid,
      })

      assert.equal(call.functionName, 'findPieceIdsByCid')
      assert.deepEqual(call.args, [1n, { data: toHex(pieceCid.bytes) }, 0n, 1n])
      assert.equal(call.address, calibration.contracts.pdp.address)
      assert.equal(call.abi, calibration.contracts.pdp.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = findPieceIdsByCidCall({
        chain: mainnet,
        dataSetId: 1n,
        pieceCid,
      })

      assert.equal(call.functionName, 'findPieceIdsByCid')
      assert.deepEqual(call.args, [1n, { data: toHex(pieceCid.bytes) }, 0n, 1n])
      assert.equal(call.address, mainnet.contracts.pdp.address)
      assert.equal(call.abi, mainnet.contracts.pdp.abi)
    })

    it('should use provided startPieceId and limit', () => {
      const call = findPieceIdsByCidCall({
        chain: calibration,
        dataSetId: 1n,
        pieceCid,
        startPieceId: 10n,
        limit: 5n,
      })

      assert.deepEqual(call.args, [1n, { data: toHex(pieceCid.bytes) }, 10n, 5n])
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = findPieceIdsByCidCall({
        chain: calibration,
        dataSetId: 1n,
        pieceCid,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('findPieceIdsByCid (with mocked RPC)', () => {
    it('should find piece IDs by CID', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const pieceCid = Piece.parse('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      const result = await findPieceIdsByCid(client, { dataSetId: 1n, pieceCid })

      assert.ok(Array.isArray(result))
      assert.equal(result.length, 1)
      assert.equal(result[0], 0n)
    })

    it('should return empty array when piece not found', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            findPieceIdsByCid: () => [[]],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const pieceCid = Piece.parse('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      const result = await findPieceIdsByCid(client, { dataSetId: 1n, pieceCid })

      assert.ok(Array.isArray(result))
      assert.equal(result.length, 0)
    })

    it('should return multiple piece IDs', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            findPieceIdsByCid: () => [[42n, 99n]],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const pieceCid = Piece.parse('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      const result = await findPieceIdsByCid(client, { dataSetId: 1n, pieceCid, limit: 10n })

      assert.ok(Array.isArray(result))
      assert.equal(result.length, 2)
      assert.equal(result[0], 42n)
      assert.equal(result[1], 99n)
    })
  })
})
