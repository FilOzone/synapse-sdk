import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { isProviderActive, isProviderActiveCall } from '../src/sp-registry/is-provider-active.ts'

describe('isProviderActive', () => {
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

  describe('isProviderActiveCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = isProviderActiveCall({
        chain: calibration,
        providerId: 1n,
      })

      assert.equal(call.functionName, 'isProviderActive')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = isProviderActiveCall({
        chain: mainnet,
        providerId: 1n,
      })

      assert.equal(call.functionName, 'isProviderActive')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = isProviderActiveCall({
        chain: calibration,
        providerId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('isProviderActive (with mocked RPC)', () => {
    it('should return true for active provider', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const isActive = await isProviderActive(client, {
        providerId: 1n,
      })

      assert.equal(isActive, true)
    })

    it('should return false for inactive provider', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const isActive = await isProviderActive(client, {
        providerId: 3n,
      })

      assert.equal(isActive, false)
    })
  })
})
