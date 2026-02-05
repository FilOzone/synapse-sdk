import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { getProviderIds, getProviderIdsCall, parseGetProviderIds } from '../src/endorsements/get-provider-ids.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'

describe('getProviderIds', () => {
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

  describe('getProviderIdsCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getProviderIdsCall({
        chain: calibration,
      })

      assert.equal(call.functionName, 'getProviderIds')
      assert.deepEqual(call.args, [])
      assert.equal(call.address, calibration.contracts.endorsements.address)
      assert.equal(call.abi, calibration.contracts.endorsements.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getProviderIdsCall({
        chain: mainnet,
      })

      assert.equal(call.functionName, 'getProviderIds')
      assert.deepEqual(call.args, [])
      assert.equal(call.address, mainnet.contracts.endorsements.address)
      assert.equal(call.abi, mainnet.contracts.endorsements.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getProviderIdsCall({
        chain: calibration,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('parseGetProviderIds', () => {
    it('should convert array to Set', () => {
      const data = [1n, 2n, 3n]
      const result = parseGetProviderIds(data)
      assert.deepEqual(result, new Set([1n, 2n, 3n]))
    })

    it('should deduplicate provider IDs', () => {
      const data = [1n, 2n, 1n, 3n, 2n]
      const result = parseGetProviderIds(data)
      assert.deepEqual(result, new Set([1n, 2n, 3n]))
    })
  })

  describe('getProviderIds (with mocked RPC)', () => {
    it('should fetch endorsed provider IDs', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          endorsements: {
            ...presets.basic.endorsements,
            getProviderIds: () => [[1n, 2n, 3n]],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const providerIds = await getProviderIds(client)

      assert.deepEqual(providerIds, new Set([1n, 2n, 3n]))
    })

    it('should return empty Set when no providers endorsed', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          endorsements: {
            ...presets.basic.endorsements,
            getProviderIds: () => [[]],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const providerIds = await getProviderIds(client)

      assert.deepEqual(providerIds, new Set())
    })
  })
})
