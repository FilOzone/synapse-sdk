import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getProviderIdByAddress, getProviderIdByAddressCall } from '../src/sp-registry/get-provider-id-by-address.ts'

describe('getProviderIdByAddress', () => {
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

  describe('getProviderIdByAddressCall', () => {
    it('should create call with calibration chain defaults', () => {
      const providerAddress = '0x1234567890123456789012345678901234567890'
      const call = getProviderIdByAddressCall({
        chain: calibration,
        providerAddress,
      })

      assert.equal(call.functionName, 'getProviderIdByAddress')
      assert.deepEqual(call.args, [providerAddress])
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const providerAddress = '0x1234567890123456789012345678901234567890'
      const call = getProviderIdByAddressCall({
        chain: mainnet,
        providerAddress,
      })

      assert.equal(call.functionName, 'getProviderIdByAddress')
      assert.deepEqual(call.args, [providerAddress])
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
    })

    it('should use custom address when provided', () => {
      const providerAddress = '0x1234567890123456789012345678901234567890'
      const customAddress = '0x9876543210987654321098765432109876543210'
      const call = getProviderIdByAddressCall({
        chain: calibration,
        providerAddress,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getProviderIdByAddress (with mocked RPC)', () => {
    it('should return provider ID for registered provider 1', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      // Provider 1's address from ADDRESSES.serviceProvider1
      const providerId = await getProviderIdByAddress(client, {
        providerAddress: '0x0000000000000000000000000000000000000001',
      })

      assert.equal(providerId, 1n)
    })

    it('should return provider ID for registered provider 2', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      // Provider 2's address from ADDRESSES.serviceProvider2
      const providerId = await getProviderIdByAddress(client, {
        providerAddress: '0x0000000000000000000000000000000000000002',
      })

      assert.equal(providerId, 2n)
    })

    it('should return 0 for unregistered address', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const providerId = await getProviderIdByAddress(client, {
        providerAddress: '0x9999999999999999999999999999999999999999',
      })

      assert.equal(providerId, 0n)
    })
  })
})
