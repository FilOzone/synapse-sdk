import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { isRegisteredProvider, isRegisteredProviderCall } from '../src/sp-registry/is-registered-provider.ts'

describe('isRegisteredProvider', () => {
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

  describe('isRegisteredProviderCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = isRegisteredProviderCall({
        chain: calibration,
        provider: ADDRESSES.serviceProvider1,
      })

      assert.equal(call.functionName, 'isRegisteredProvider')
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
      assert.equal(call.args[0], ADDRESSES.serviceProvider1)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = isRegisteredProviderCall({
        chain: mainnet,
        provider: ADDRESSES.serviceProvider1,
      })

      assert.equal(call.functionName, 'isRegisteredProvider')
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = isRegisteredProviderCall({
        chain: calibration,
        provider: ADDRESSES.serviceProvider1,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('isRegisteredProvider (with mocked RPC)', () => {
    it('should return true for registered provider', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            isRegisteredProvider: () => [true],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const registered = await isRegisteredProvider(client, {
        provider: ADDRESSES.serviceProvider1,
      })

      assert.equal(registered, true)
    })

    it('should return false for unregistered provider', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            isRegisteredProvider: () => [false],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const registered = await isRegisteredProvider(client, {
        provider: ADDRESSES.zero,
      })

      assert.equal(registered, false)
    })
  })
})
