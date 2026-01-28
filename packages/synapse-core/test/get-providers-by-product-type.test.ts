import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  getProvidersByProductType,
  getProvidersByProductTypeCall,
} from '../src/sp-registry/get-providers-by-product-type.ts'

describe('getProvidersByProductType', () => {
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

  describe('getProvidersByProductTypeCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getProvidersByProductTypeCall({
        chain: calibration,
        productType: 0,
        onlyActive: true,
      })

      assert.equal(call.functionName, 'getProvidersByProductType')
      assert.deepEqual(call.args, [0, true, 0n, 50n])
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getProvidersByProductTypeCall({
        chain: mainnet,
        productType: 0,
        onlyActive: true,
      })

      assert.equal(call.functionName, 'getProvidersByProductType')
      assert.deepEqual(call.args, [0, true, 0n, 50n])
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
    })

    it('should use provided offset and limit', () => {
      const call = getProvidersByProductTypeCall({
        chain: calibration,
        productType: 0,
        onlyActive: true,
        offset: 10n,
        limit: 100n,
      })

      assert.deepEqual(call.args, [0, true, 10n, 100n])
    })

    it('should use default onlyActive=true when not provided', () => {
      const call = getProvidersByProductTypeCall({
        chain: calibration,
        productType: 0,
      })

      assert.deepEqual(call.args, [0, true, 0n, 50n])
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getProvidersByProductTypeCall({
        chain: calibration,
        productType: 0,
        onlyActive: true,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getProvidersByProductType (with mocked RPC)', () => {
    it('should return paginated providers with defaults', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const result = await getProvidersByProductType(client, {
        productType: 0,
        onlyActive: true,
      })

      assert.equal(result.providers.length, 2)
      assert.equal(result.hasMore, false)
      assert.equal(result.providers[0].providerId, 1n)
      assert.equal(result.providers[0].providerInfo.name, 'Test Provider 1')
      assert.equal(result.providers[0].product.isActive, true)
      assert.equal(result.providers[1].providerId, 2n)
      assert.equal(result.providers[1].providerInfo.name, 'Test Provider 2')
    })
  })
})
