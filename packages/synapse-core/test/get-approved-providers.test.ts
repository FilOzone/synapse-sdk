import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getApprovedProviders, getApprovedProvidersCall } from '../src/warm-storage/get-approved-providers.ts'

describe('getApprovedProviders', () => {
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

  describe('getApprovedProvidersCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getApprovedProvidersCall({
        chain: calibration,
      })

      assert.equal(call.functionName, 'getApprovedProviders')
      assert.deepEqual(call.args, [0n, 0n]) // default offset and limit
      assert.equal(call.address, calibration.contracts.storageView.address)
      assert.equal(call.abi, calibration.contracts.storageView.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getApprovedProvidersCall({
        chain: mainnet,
      })

      assert.equal(call.functionName, 'getApprovedProviders')
      assert.deepEqual(call.args, [0n, 0n])
      assert.equal(call.address, mainnet.contracts.storageView.address)
      assert.equal(call.abi, mainnet.contracts.storageView.abi)
    })

    it('should use custom offset and limit', () => {
      const call = getApprovedProvidersCall({
        chain: calibration,
        offset: 10n,
        limit: 50n,
      })

      assert.deepEqual(call.args, [10n, 50n])
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getApprovedProvidersCall({
        chain: calibration,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getApprovedProviders (with mocked RPC)', () => {
    it('should fetch approved providers', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const providerIds = await getApprovedProviders(client)

      assert.deepEqual(providerIds, [1n, 2n])
    })

    it('should fetch approved providers with custom offset and limit', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getApprovedProviders: (args) => {
              const [offset, limit] = args
              assert.equal(offset, 5n)
              assert.equal(limit, 10n)
              return [[3n, 4n, 5n]]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const providerIds = await getApprovedProviders(client, {
        offset: 5n,
        limit: 10n,
      })

      assert.deepEqual(providerIds, [3n, 4n, 5n])
    })

    it('should return empty array when no providers approved', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getApprovedProviders: () => [[]],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const providerIds = await getApprovedProviders(client)

      assert.deepEqual(providerIds, [])
    })
  })
})
