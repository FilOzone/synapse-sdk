import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getProviderCount, getProviderCountCall } from '../src/sp-registry/get-provider-count.ts'

describe('getProviderCount', () => {
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

  describe('getProviderCountCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getProviderCountCall({
        chain: calibration,
      })

      assert.equal(call.functionName, 'getProviderCount')
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
      assert.deepEqual(call.args, [])
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getProviderCountCall({
        chain: mainnet,
      })

      assert.equal(call.functionName, 'getProviderCount')
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getProviderCountCall({
        chain: calibration,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getProviderCount (with mocked RPC)', () => {
    it('should return provider count', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderCount: () => [2n],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const count = await getProviderCount(client, {})

      assert.equal(count, 2n)
    })
  })
})
