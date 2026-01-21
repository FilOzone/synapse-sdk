import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getServicePrice, getServicePriceCall } from '../src/warm-storage/get-service-price.ts'

describe('getServicePrice', () => {
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

  describe('getServicePriceCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getServicePriceCall({
        chain: calibration,
      })

      assert.equal(call.functionName, 'getServicePrice')
      assert.deepEqual(call.args, [])
      assert.equal(call.address, calibration.contracts.storage.address)
      assert.equal(call.abi, calibration.contracts.storage.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getServicePriceCall({
        chain: mainnet,
      })

      assert.equal(call.functionName, 'getServicePrice')
      assert.deepEqual(call.args, [])
      assert.equal(call.address, mainnet.contracts.storage.address)
      assert.equal(call.abi, mainnet.contracts.storage.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getServicePriceCall({
        chain: calibration,
        address: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getServicePrice (with mocked RPC)', () => {
    it('should fetch service price', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const price = await getServicePrice(client)

      assert.equal(typeof price.pricePerTiBPerMonthNoCDN, 'bigint')
      assert.equal(typeof price.pricePerTiBCdnEgress, 'bigint')
      assert.equal(typeof price.pricePerTiBCacheMissEgress, 'bigint')
      assert.equal(typeof price.minimumPricePerMonth, 'bigint')
      assert.equal(typeof price.tokenAddress, 'string')
      assert.equal(typeof price.epochsPerMonth, 'bigint')
    })

    it('should fetch service price with empty options', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const price = await getServicePrice(client, {})

      assert.ok(price.pricePerTiBPerMonthNoCDN > 0n)
    })
  })
})
