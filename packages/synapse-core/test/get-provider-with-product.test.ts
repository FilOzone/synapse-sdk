import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getProviderWithProduct, getProviderWithProductCall } from '../src/sp-registry/get-provider-with-product.ts'

describe('getProviderWithProduct', () => {
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

  describe('getProviderWithProductCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getProviderWithProductCall({
        chain: calibration,
        providerId: 1n,
        productType: 0,
      })

      assert.equal(call.functionName, 'getProviderWithProduct')
      assert.deepEqual(call.args, [1n, 0])
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getProviderWithProductCall({
        chain: mainnet,
        providerId: 1n,
        productType: 0,
      })

      assert.equal(call.functionName, 'getProviderWithProduct')
      assert.deepEqual(call.args, [1n, 0])
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getProviderWithProductCall({
        chain: calibration,
        providerId: 1n,
        productType: 0,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getProviderWithProduct (with mocked RPC)', () => {
    it('should return provider with product details', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const provider = await getProviderWithProduct(client, {
        providerId: 1n,
        productType: 0,
      })

      assert.equal(provider.providerId, 1n)
      assert.equal(provider.providerInfo.name, 'Test Provider')
      assert.equal(provider.product.isActive, true)
      assert.equal(provider.productCapabilityValues.length, 7)
    })

    it('should return inactive provider structure for non-existent provider', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      try {
        await getProviderWithProduct(client, {
          providerId: 999n,
          productType: 0,
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.include(error.message, 'Provider not found')
      }
    })
  })
})
