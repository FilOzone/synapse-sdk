import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, encodeAbiParameters, encodeEventTopics, http, numberToHex, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Abis from '../src/abis/index.ts'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { addProduct, addProductCall, addProductSync } from '../src/sp-registry/add-product.ts'
import { encodePDPCapabilities } from '../src/utils/pdp-capabilities.ts'

describe('addProduct', () => {
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

  describe('addProductCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = addProductCall({
        chain: calibration,
        productType: 0,
        capabilityKeys: ['serviceURL'],
        capabilityValues: ['0x'],
      })

      assert.equal(call.functionName, 'addProduct')
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
      assert.equal(call.args[0], 0)
      assert.deepEqual(call.args[1], ['serviceURL'])
      assert.deepEqual(call.args[2], ['0x'])
    })

    it('should create call with mainnet chain defaults', () => {
      const call = addProductCall({
        chain: mainnet,
        productType: 0,
        capabilityKeys: ['serviceURL'],
        capabilityValues: ['0x'],
      })

      assert.equal(call.functionName, 'addProduct')
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = addProductCall({
        chain: calibration,
        productType: 0,
        capabilityKeys: ['serviceURL'],
        capabilityValues: ['0x'],
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('addProduct (with mocked RPC)', () => {
    it('should add product and return transaction hash', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            addProduct: () => {
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

      const hash = await addProduct(client, {
        pdpOffering: {
          serviceURL: 'https://provider.example.com',
          minPieceSizeInBytes: 1024n,
          maxPieceSizeInBytes: 1073741824n,
          storagePricePerTibPerDay: parseEther('0.1'),
          minProvingPeriodInEpochs: 2880n,
          location: 'us-east',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      })

      assert.ok(hash.startsWith('0x'))
      assert.equal(hash.length, 66) // 0x + 64 hex chars
    })
  })

  describe('addProductSync', () => {
    it('should add product and wait for confirmation', async () => {
      let onHashCalled = false
      let onHashValue: string | undefined
      const providerId = 1n
      const productType = 0

      const pdpOffering = {
        serviceURL: 'https://provider.example.com',
        minPieceSizeInBytes: 1024n,
        maxPieceSizeInBytes: 1073741824n,
        storagePricePerTibPerDay: parseEther('0.1'),
        minProvingPeriodInEpochs: 2880n,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
      }
      const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering)

      // Create the event log data for the receipt
      const topics = encodeEventTopics({
        abi: Abis.serviceProviderRegistry,
        eventName: 'ProductAdded',
        args: {
          providerId,
          productType,
        },
      })

      const eventData = encodeAbiParameters(
        [
          { name: 'serviceProvider', type: 'address' },
          { name: 'capabilityKeys', type: 'string[]' },
          { name: 'capabilityValues', type: 'bytes[]' },
        ],
        [ADDRESSES.serviceProvider1, capabilityKeys, capabilityValues]
      )

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            addProduct: () => {
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
                  data: eventData,
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

      const { receipt, event } = await addProductSync(client, {
        pdpOffering,
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
      assert.equal(event.eventName, 'ProductAdded')
      assert.equal(event.args.providerId, providerId)
      assert.equal(event.args.productType, productType)
    })
  })
})
