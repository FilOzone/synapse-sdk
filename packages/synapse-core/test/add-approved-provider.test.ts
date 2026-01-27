import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { addApprovedProvider, addApprovedProviderCall } from '../src/warm-storage/add-approved-provider.ts'

describe('addApprovedProvider', () => {
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

  describe('addApprovedProviderCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = addApprovedProviderCall({
        chain: calibration,
        providerId: 1n,
      })

      assert.equal(call.functionName, 'addApprovedProvider')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, calibration.contracts.storage.address)
      assert.equal(call.abi, calibration.contracts.storage.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = addApprovedProviderCall({
        chain: mainnet,
        providerId: 456n,
      })

      assert.equal(call.functionName, 'addApprovedProvider')
      assert.deepEqual(call.args, [456n])
      assert.equal(call.address, mainnet.contracts.storage.address)
      assert.equal(call.abi, mainnet.contracts.storage.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = addApprovedProviderCall({
        chain: calibration,
        providerId: 1n,
        address: customAddress,
      })

      assert.equal(call.address, customAddress)
      assert.deepEqual(call.args, [1n])
    })

    it('should handle large providerId values', () => {
      const largeId = 2n ** 128n
      const call = addApprovedProviderCall({
        chain: calibration,
        providerId: largeId,
      })

      assert.deepEqual(call.args, [largeId])
    })
  })

  describe('addApprovedProvider (with mocked RPC)', () => {
    it('should add approved provider and return transaction hash', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
            addApprovedProvider: (args) => {
              assert.deepEqual(args, [1n])
              return []
            },
          },
        })
      )

      const account = privateKeyToAccount(PRIVATE_KEYS.key1)
      const client = createWalletClient({
        account,
        chain: calibration,
        transport: http(),
      })

      const hash = await addApprovedProvider(client, {
        providerId: 1n,
      })

      assert.ok(hash.startsWith('0x'))
      assert.equal(hash.length, 66) // 0x + 64 hex chars
    })
  })
})
