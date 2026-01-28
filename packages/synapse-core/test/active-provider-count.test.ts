import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { activeProviderCount, activeProviderCountCall } from '../src/sp-registry/active-provider-count.ts'

describe('activeProviderCount', () => {
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

  describe('activeProviderCountCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = activeProviderCountCall({
        chain: calibration,
      })

      assert.equal(call.functionName, 'activeProviderCount')
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
      assert.deepEqual(call.args, [])
    })

    it('should create call with mainnet chain defaults', () => {
      const call = activeProviderCountCall({
        chain: mainnet,
      })

      assert.equal(call.functionName, 'activeProviderCount')
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = activeProviderCountCall({
        chain: calibration,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('activeProviderCount (with mocked RPC)', () => {
    it('should return active provider count', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            activeProviderCount: () => [1n],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const count = await activeProviderCount(client, {})

      assert.equal(count, 1n)
    })
  })
})
