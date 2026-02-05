import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { removeApprovedProvider, removeApprovedProviderCall } from '../src/warm-storage/remove-approved-provider.ts'

describe('removeApprovedProvider', () => {
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

  describe('removeApprovedProviderCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = removeApprovedProviderCall({
        chain: calibration,
        providerId: 1n,
        index: 0n,
      })

      assert.equal(call.functionName, 'removeApprovedProvider')
      assert.deepEqual(call.args, [1n, 0n])
      assert.equal(call.address, calibration.contracts.fwss.address)
      assert.equal(call.abi, calibration.contracts.fwss.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = removeApprovedProviderCall({
        chain: mainnet,
        providerId: 456n,
        index: 2n,
      })

      assert.equal(call.functionName, 'removeApprovedProvider')
      assert.deepEqual(call.args, [456n, 2n])
      assert.equal(call.address, mainnet.contracts.fwss.address)
      assert.equal(call.abi, mainnet.contracts.fwss.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = removeApprovedProviderCall({
        chain: calibration,
        providerId: 1n,
        index: 0n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
      assert.deepEqual(call.args, [1n, 0n])
    })

    it('should handle large providerId values', () => {
      const largeId = 2n ** 128n
      const call = removeApprovedProviderCall({
        chain: calibration,
        providerId: largeId,
        index: 5n,
      })

      assert.deepEqual(call.args, [largeId, 5n])
    })
  })

  describe('removeApprovedProvider (with mocked RPC)', () => {
    it('should remove approved provider and return transaction hash', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
            removeApprovedProvider: (args) => {
              assert.deepEqual(args, [1n, 0n])
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

      const hash = await removeApprovedProvider(client, {
        providerId: 1n,
        index: 0n,
      })

      assert.ok(hash.startsWith('0x'))
      assert.equal(hash.length, 66) // 0x + 64 hex chars
    })
  })
})
