import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, encodeEventTopics, http, numberToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Abis from '../src/abis/index.ts'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { removeProvider, removeProviderCall, removeProviderSync } from '../src/sp-registry/remove-provider.ts'

describe('removeProvider', () => {
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

  describe('removeProviderCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = removeProviderCall({
        chain: calibration,
      })

      assert.equal(call.functionName, 'removeProvider')
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
      assert.deepEqual(call.args, [])
    })

    it('should create call with mainnet chain defaults', () => {
      const call = removeProviderCall({
        chain: mainnet,
      })

      assert.equal(call.functionName, 'removeProvider')
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
      assert.deepEqual(call.args, [])
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = removeProviderCall({
        chain: calibration,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('removeProvider (with mocked RPC)', () => {
    it('should remove provider and return transaction hash', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            removeProvider: () => {
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

      const hash = await removeProvider(client, {})

      assert.ok(hash.startsWith('0x'))
      assert.equal(hash.length, 66) // 0x + 64 hex chars
    })
  })

  describe('removeProviderSync', () => {
    it('should remove provider and wait for confirmation', async () => {
      let onHashCalled = false
      let onHashValue: string | undefined
      const providerId = 1n

      // Create the event log data for the receipt
      const topics = encodeEventTopics({
        abi: Abis.serviceProviderRegistry,
        eventName: 'ProviderRemoved',
        args: {
          providerId,
        },
      })

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            removeProvider: () => {
              return []
            },
          },
          eth_getTransactionReceipt: (params) => {
            const [hash] = params
            return {
              hash,
              from: ADDRESSES.serviceProvider1,
              to: calibration.contracts.serviceProviderRegistry.address,
              contractAddress: null,
              index: 0,
              root: '0x0000000000000000000000000000000000000000000000000000000000000000',
              gasUsed: numberToHex(50000n),
              gasPrice: numberToHex(1000000000n),
              cumulativeGasUsed: numberToHex(50000n),
              effectiveGasPrice: numberToHex(1000000000n),
              logsBloom: `0x${'0'.repeat(512)}`,
              blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              blockNumber: numberToHex(1000000n),
              logs: [
                {
                  address: calibration.contracts.serviceProviderRegistry.address,
                  topics,
                  data: '0x',
                  blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                  blockNumber: numberToHex(1000000n),
                  transactionHash: hash,
                  transactionIndex: numberToHex(0),
                  logIndex: numberToHex(0),
                  removed: false,
                },
              ],
              status: '0x1',
            }
          },
        })
      )

      const account = privateKeyToAccount(PRIVATE_KEYS.key1)
      const client = createWalletClient({
        account,
        chain: calibration,
        transport: http(),
      })

      const { receipt, event } = await removeProviderSync(client, {
        onHash: (hash) => {
          onHashCalled = true
          onHashValue = hash
        },
      })

      assert.ok(onHashCalled, 'onHash callback should be called')
      assert.ok(onHashValue?.startsWith('0x'), 'onHash should receive a valid hash')
      assert.ok(receipt, 'Receipt should exist')
      assert.equal(receipt.status, 'success')
      assert.ok(event, 'Event should exist')
      assert.equal(event.eventName, 'ProviderRemoved')
      assert.equal(event.args.providerId, providerId)
    })
  })
})
