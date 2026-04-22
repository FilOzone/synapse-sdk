import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  getClientDataSets,
  getClientDataSetsCall,
  getClientDataSetsIterable,
} from '../src/warm-storage/get-client-data-sets.ts'

describe('getClientDataSets', () => {
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

  describe('getClientDataSetsCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getClientDataSetsCall({
        chain: calibration,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'getClientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 0n, 0n])
      assert.equal(call.address, calibration.contracts.fwssView.address)
      assert.equal(call.abi, calibration.contracts.fwssView.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getClientDataSetsCall({
        chain: mainnet,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'getClientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 0n, 0n])
      assert.equal(call.address, mainnet.contracts.fwssView.address)
      assert.equal(call.abi, mainnet.contracts.fwssView.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getClientDataSetsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })

    it('should use paginated args when offset is provided', () => {
      const call = getClientDataSetsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        offset: 10n,
        limit: 50n,
      })

      assert.equal(call.functionName, 'getClientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 10n, 50n])
    })

    it('should default offset/limit to 0n when not provided', () => {
      const call = getClientDataSetsCall({
        chain: calibration,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'getClientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 0n, 0n])
    })
  })

  describe('getClientDataSets (with mocked RPC)', () => {
    it('should fetch client data sets', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getClientDataSets(client, {
        address: ADDRESSES.client1,
      })

      assert.ok(dataSets.length > 0)
      const [first] = dataSets
      assert.ok(first)
      if (!first) return

      assert.equal(typeof first.pdpRailId, 'bigint')
      assert.equal(typeof first.cacheMissRailId, 'bigint')
      assert.equal(typeof first.cdnRailId, 'bigint')
      assert.equal(typeof first.payer, 'string')
      assert.equal(typeof first.payee, 'string')
      assert.equal(typeof first.serviceProvider, 'string')
      assert.equal(typeof first.commissionBps, 'bigint')
      assert.equal(typeof first.clientDataSetId, 'bigint')
      assert.equal(typeof first.pdpEndEpoch, 'bigint')
      assert.equal(typeof first.providerId, 'bigint')
      assert.equal(typeof first.dataSetId, 'bigint')
    })

    it('should fetch client data sets with pagination', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getClientDataSets(client, {
        address: ADDRESSES.client1,
        offset: 0n,
        limit: 10n,
      })

      assert.ok(dataSets.length > 0)
      const [first] = dataSets
      assert.ok(first)
      if (!first) return

      assert.equal(typeof first.pdpRailId, 'bigint')
      assert.equal(typeof first.dataSetId, 'bigint')
      assert.equal(typeof first.payer, 'string')
      assert.equal(typeof first.payee, 'string')
    })

    it('should return all remaining data sets when limit is 0n', async () => {
      const expectedDataSets = Array.from({ length: 150 }, (_, index) => makeDataSet(BigInt(index + 1)))
      const calls: Array<[string, bigint, bigint]> = []

      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: (args) => {
              const [address, offset = 0n, limit = 0n] = args
              calls.push([address, offset, limit])
              if (offset === 0n && limit === 100n) {
                return [expectedDataSets.slice(0, 100)]
              }

              if (offset === 100n && limit === 100n) {
                return [expectedDataSets.slice(100)]
              }

              return [[]]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getClientDataSets(client, {
        address: ADDRESSES.client1,
        limit: 0n,
      })

      assert.deepEqual(dataSets, expectedDataSets)
      assert.deepEqual(calls, [
        [ADDRESSES.client1, 0n, 100n],
        [ADDRESSES.client1, 100n, 100n],
      ])
    })

    it('should paginate when limit is greater than 100n', async () => {
      const expectedDataSets = Array.from({ length: 150 }, (_, index) => makeDataSet(BigInt(index + 1)))
      const calls: Array<[string, bigint, bigint]> = []

      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: (args) => {
              const [address, offset = 0n, limit = 0n] = args
              calls.push([address, offset, limit])

              if (offset === 0n && limit === 100n) {
                return [expectedDataSets.slice(0, 100)]
              }

              if (offset === 100n && limit === 50n) {
                return [expectedDataSets.slice(100)]
              }

              return [[]]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getClientDataSets(client, {
        address: ADDRESSES.client1,
        limit: 150n,
      })

      assert.deepEqual(dataSets, expectedDataSets)
      assert.deepEqual(calls, [
        [ADDRESSES.client1, 0n, 100n],
        [ADDRESSES.client1, 100n, 50n],
      ])
    })

    it('should fetch all data sets with paginated iterable reads', async () => {
      const expectedDataSets = [makeDataSet(1n), makeDataSet(2n), makeDataSet(3n)]
      const calls: Array<[string, bigint, bigint]> = []

      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: (args) => {
              const [address, offset = 0n, limit = 0n] = args
              calls.push([address, offset, limit])
              assert.equal(limit, 2n)

              if (offset === 0n) {
                return [expectedDataSets.slice(0, 2)]
              }

              if (offset === 2n) {
                return [expectedDataSets.slice(2)]
              }

              return [[]]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = []
      for await (const dataSet of getClientDataSetsIterable(client, {
        address: ADDRESSES.client1,
        batchSize: 2n,
      })) {
        dataSets.push(dataSet)
      }

      assert.deepEqual(dataSets, expectedDataSets)
      assert.deepEqual(calls, [
        [ADDRESSES.client1, 0n, 2n],
        [ADDRESSES.client1, 2n, 2n],
      ])
    })

    it('should reject non-positive iterable batch sizes', async () => {
      let calls = 0

      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: (args) => {
              calls += 1
              return presets.basic.warmStorageView?.getClientDataSets?.(args) ?? [[]]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      await assert.rejects(async () => {
        for await (const _dataSet of getClientDataSetsIterable(client, {
          address: ADDRESSES.client1,
          batchSize: 0n,
        })) {
          // no-op
        }
      }, /`batchSize` must be greater than 0n\./)

      assert.equal(calls, 0)
    })
  })
})

function makeDataSet(dataSetId: bigint) {
  return {
    pdpRailId: 1n,
    cacheMissRailId: 0n,
    cdnRailId: 0n,
    payer: ADDRESSES.client1,
    payee: ADDRESSES.serviceProvider1,
    serviceProvider: ADDRESSES.serviceProvider1,
    commissionBps: 100n,
    clientDataSetId: 0n,
    pdpEndEpoch: 0n,
    providerId: 1n,
    dataSetId,
  }
}
