/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import pDefer from 'p-defer'
import { type Address, isAddressEqual, parseUnits } from 'viem'
import { PaymentsService } from '../payments/index.ts'
import { PDP_PERMISSIONS } from '../session/key.ts'
import { Synapse } from '../synapse.ts'
import { makeDataSetCreatedLog } from './mocks/events.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from './mocks/jsonrpc/index.ts'
import { createDataSetHandler, dataSetCreationStatusHandler, type PDPMockOptions } from './mocks/pdp/handlers.ts'
import { PING } from './mocks/ping.ts'

// mock server for testing
const server = setup([])

describe('Synapse', () => {
  let signer: ethers.Signer
  let provider: ethers.Provider
  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })
  beforeEach(() => {
    server.resetHandlers()
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
  })

  describe('Instantiation', () => {
    it('should create instance with signer', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({ signer })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)
    })

    it('should create instance with provider', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({ provider })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)
    })

    it('should create instance with private key', async () => {
      server.use(JSONRPC(presets.basic))
      const privateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      const rpcURL = 'https://api.calibration.node.glif.io/rpc/v1'
      const synapse = await Synapse.create({ privateKey, rpcURL })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)
    })

    it('should apply NonceManager by default', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({ signer })
      assert.exists(synapse)
      // We can't directly check if NonceManager is applied, but we can verify the instance is created
    })

    it('should allow disabling NonceManager', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({
        signer,
        disableNonceManager: true,
      })
      assert.exists(synapse)
      // We can't directly check if NonceManager is not applied, but we can verify the instance is created
    })

    it.skip('should allow enabling CDN', async () => {
      // Skip this test as it requires real contract interactions
      const synapse = await Synapse.create({
        signer,
        withCDN: true,
      })
      const storageService = await synapse.createStorage()
      assert.exists(storageService)
      // CDN is part of the storage service configuration
    })

    it('should reject when no authentication method provided', async () => {
      try {
        await Synapse.create({} as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Must provide exactly one of')
      }
    })

    it('should reject when multiple authentication methods provided', async () => {
      try {
        await Synapse.create({
          privateKey: '0x123',
          provider,
          rpcURL: 'https://example.com',
        } as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Must provide exactly one of')
      }
    })

    it('should reject privateKey without rpcURL', async () => {
      try {
        await Synapse.create({
          privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'rpcURL is required when using privateKey')
      }
    })
  })

  describe('Network validation', () => {
    it('should reject unsupported networks', async () => {
      // Create mock provider with unsupported chain ID
      // const unsupportedProvider = createMockProvider(999999)
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_chainId: '999999',
        })
      )
      try {
        await Synapse.create({ provider })
        assert.fail('Should have thrown for unsupported network')
      } catch (error: any) {
        assert.include(error.message, 'Unsupported network')
        assert.include(error.message, '999999')
      }
    })

    it('should accept calibration network', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_chainId: '314159',
        })
      )
      const synapse = await Synapse.create({ provider })
      assert.exists(synapse)
    })

    it('should accept mainnet with custom warmStorage address', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_chainId: '314',
        })
      )
      const synapse = await Synapse.create({
        provider,
        warmStorageAddress: '0x1234567890123456789012345678901234567890', // Custom address for mainnet
        pdpVerifierAddress: '0x9876543210987654321098765432109876543210', // Custom PDPVerifier address for mainnet
      })
      assert.exists(synapse)
    })

    // custom addresses are not used anymore in the SDK
    it.skip('should accept custom pdpVerifierAddress', async () => {
      const customPDPVerifierAddress = '0xabcdef1234567890123456789012345678901234'
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            pdpVerifierAddress: () => [customPDPVerifierAddress],
          },
        })
      )

      const synapse = await Synapse.create({
        provider,
        pdpVerifierAddress: customPDPVerifierAddress,
      })
      assert.exists(synapse)
      assert.ok(isAddressEqual(synapse.getPDPVerifierAddress() as Address, customPDPVerifierAddress))
    })

    // theres no default pdpVerifierAddress in the SDK anymore
    it.skip('should use default pdpVerifierAddress when not provided', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({
        provider,
      })
      assert.exists(synapse)
      assert.ok(isAddressEqual(synapse.getPDPVerifierAddress() as Address, ADDRESSES.calibration.pdpVerifier))
    })

    // custom addresses are not used anymore in the SDK
    it.skip('should accept both custom warmStorageAddress and pdpVerifierAddress', async () => {
      const customPDPVerifierAddress = '0x2222222222222222222222222222222222222222'

      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({
        provider,
        warmStorageAddress: ADDRESSES.mainnet.warmStorage,
        pdpVerifierAddress: customPDPVerifierAddress,
      })
      assert.exists(synapse)
      assert.equal(synapse.getWarmStorageAddress(), ADDRESSES.mainnet.warmStorage)
      assert.ok(isAddressEqual(synapse.getPDPVerifierAddress() as Address, customPDPVerifierAddress))
    })
  })

  describe('StorageManager access', () => {
    it('should provide access to StorageManager via synapse.storage', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({ signer })

      // Should be able to access storage manager
      assert.exists(synapse.storage)
      assert.isObject(synapse.storage)

      // Should have all storage manager methods available
      assert.isFunction(synapse.storage.upload)
      assert.isFunction(synapse.storage.download)
      assert.isFunction(synapse.storage.createContext)
      assert.isFunction(synapse.storage.getDefaultContext)
      assert.isFunction(synapse.storage.findDataSets)
    })

    it('should create storage manager with CDN settings', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({
        signer,
        withCDN: true,
      })

      assert.exists(synapse.storage)
      // The storage manager should inherit the withCDN setting
      // We can't directly test this without accessing private properties
      // but it will be used in upload/download operations
    })

    it('should return same storage manager instance', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({ signer })

      const storage1 = synapse.storage
      const storage2 = synapse.storage

      // Should be the same instance
      assert.equal(storage1, storage2)
    })
  })

  describe('Session Keys', () => {
    const DATA_SET_ID = 7
    const FAKE_TX_HASH = '0x3816d82cb7a6f5cde23f4d63c0763050d13c6b6dc659d0a7e6eba80b0ec76a18'
    const FAKE_TX = {
      hash: FAKE_TX_HASH,
      from: ADDRESSES.serviceProvider1,
      gas: '0x5208',
      value: '0x0',
      nonce: '0x444',
      input: '0x',
      v: '0x01',
      r: '0x4e2eef88cc6f2dc311aa3b1c8729b6485bd606960e6ae01522298278932c333a',
      s: '0x5d0e08d8ecd6ed8034aa956ff593de9dc1d392e73909ef0c0f828918b58327c9',
    }
    const FAKE_RECEIPT = {
      ...FAKE_TX,
      transactionHash: FAKE_TX_HASH,
      transactionIndex: '0x10',
      blockHash: '0xb91b7314248aaae06f080ad427dbae78b8c5daf72b2446cf843739aef80c6417',
      status: '0x1',
      blockNumber: '0x127001',
      cumulativeGasUsed: '0x52080',
      gasUsed: '0x5208',
      logs: [makeDataSetCreatedLog(DATA_SET_ID, 1)],
    }
    beforeEach(() => {
      const pdpOptions: PDPMockOptions = {
        baseUrl: 'https://pdp.example.com',
      }
      server.use(PING(pdpOptions))
      server.use(createDataSetHandler(FAKE_TX_HASH, pdpOptions))
      server.use(
        dataSetCreationStatusHandler(
          FAKE_TX_HASH,
          {
            ok: true,
            dataSetId: DATA_SET_ID,
            createMessageHash: '',
            dataSetCreated: true,
            service: '',
            txStatus: '',
          },
          pdpOptions
        )
      )
    })

    it('should storage.createContext with session key', async () => {
      const signerAddress = await signer.getAddress()
      const sessionKeySigner = new ethers.Wallet(PRIVATE_KEYS.key2)
      const sessionKeyAddress = await sessionKeySigner.getAddress()
      const EXPIRY = BigInt(1757618883)
      server.use(
        JSONRPC({
          ...presets.basic,
          sessionKeyRegistry: {
            authorizationExpiry: (args) => {
              const client = args[0]
              const signer = args[1]
              assert.equal(client, signerAddress)
              assert.equal(signer, sessionKeyAddress)
              const permission = args[2]
              assert.isTrue(PDP_PERMISSIONS.includes(permission))
              return [EXPIRY]
            },
          },
          payments: {
            ...presets.basic.payments,
            operatorApprovals: (args) => {
              const token = args[0]
              const client = args[1]
              const operator = args[2]
              assert.equal(token, ADDRESSES.calibration.usdfcToken)
              assert.equal(client, signerAddress)
              assert.equal(operator, ADDRESSES.calibration.warmStorage)
              return [
                true, // isApproved
                BigInt(127001 * 635000000), // rateAllowance
                BigInt(127001 * 635000000), // lockupAllowance
                BigInt(0), // rateUsage
                BigInt(0), // lockupUsage
                BigInt(28800), // maxLockupPeriod
              ]
            },
            accounts: (args) => {
              const token = args[0]
              const user = args[1]
              assert.equal(user, signerAddress)
              assert.equal(token, ADDRESSES.calibration.usdfcToken)
              return [BigInt(127001 * 635000000), BigInt(0), BigInt(0), BigInt(0)]
            },
          },
          eth_getTransactionByHash: (params) => {
            const hash = params[0]
            assert.equal(hash, FAKE_TX_HASH)
            return FAKE_TX
          },
          eth_getTransactionReceipt: (params) => {
            const hash = params[0]
            assert.equal(hash, FAKE_TX_HASH)
            return FAKE_RECEIPT
          },
        })
      )
      const synapse = await Synapse.create({ signer })
      const sessionKey = synapse.createSessionKey(sessionKeySigner)
      synapse.setSession(sessionKey)
      assert.equal(sessionKey.getSigner(), sessionKeySigner)

      const expiries = await sessionKey.fetchExpiries(PDP_PERMISSIONS)
      for (const permission of PDP_PERMISSIONS) {
        assert.equal(expiries[permission], EXPIRY)
      }

      const context = await synapse.storage.createContext()
      assert.equal((context as any)._signer, sessionKeySigner)
      const info = await context.preflightUpload(127)
      assert.isTrue(info.allowanceCheck.sufficient)

      // Payments uses the original signer
      const accountInfo = await synapse.payments.accountInfo()
      assert.equal(accountInfo.funds, BigInt(127001 * 635000000))
    })
  })

  describe('Payment access', () => {
    it('should provide read-only access to payments', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({ signer })

      // Should be able to access payments
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)

      // Should have all payment methods available
      assert.isFunction(synapse.payments.walletBalance)
      assert.isFunction(synapse.payments.balance)
      assert.isFunction(synapse.payments.deposit)
      assert.isFunction(synapse.payments.withdraw)
      assert.isFunction(synapse.payments.decimals)

      // payments property should be read-only (getter only)
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(synapse), 'payments')
      assert.exists(descriptor?.get)
      assert.notExists(descriptor?.set)
    })
  })

  describe('getProviderInfo', () => {
    it('should get provider info for valid approved provider', async () => {
      server.use(JSONRPC(presets.basic))

      const synapse = await Synapse.create({ provider })
      const providerInfo = await synapse.getProviderInfo(ADDRESSES.serviceProvider1)

      assert.ok(isAddressEqual(providerInfo.serviceProvider as Address, ADDRESSES.serviceProvider1))
      assert.equal(providerInfo.products.PDP?.data.serviceURL, 'https://pdp.example.com')
    })

    it('should throw for invalid provider address', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({ signer })

      try {
        await synapse.getProviderInfo('invalid-address')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Invalid provider address')
      }
    })

    it('should throw for non-approved provider', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderIdByAddress: () => [3n],
          },
          warmStorageView: {
            isProviderApproved: ([providerId]) => [providerId === 1n],
          },
        })
      )

      try {
        const synapse = await Synapse.create({ signer })
        await synapse.getProviderInfo(ADDRESSES.serviceProvider1)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not approved')
      }
    })

    it('should throw when provider not found', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderByAddress: () => [
              {
                providerId: 0n,
                info: {
                  serviceProvider: ADDRESSES.zero,
                  payee: ADDRESSES.zero,
                  name: '',
                  description: '',
                  isActive: false,
                },
              },
            ],
          },
        })
      )

      try {
        const synapse = await Synapse.create({ signer })
        await synapse.getProviderInfo(ADDRESSES.serviceProvider1)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not found')
      }
    })
  })

  describe('download', () => {
    it('should validate PieceCID input', async () => {
      server.use(JSONRPC(presets.basic))
      const synapse = await Synapse.create({ signer })

      try {
        await synapse.download('invalid-piece-link')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Invalid PieceCID')
        assert.include(error.message, 'invalid-piece-link')
      }
    })

    it('should accept valid PieceCID string', async () => {
      // Create test data that matches the expected PieceCID
      const testData = new TextEncoder().encode('test data')
      server.use(
        JSONRPC(presets.basic),
        http.get('https://pdp.example.com/pdp/piece', async ({ request }) => {
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')

          return HttpResponse.json({
            pieceCid,
          })
        }),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )

      const synapse = await Synapse.create({
        signer,
      })

      // Use the actual PieceCID for 'test data'
      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'
      const data = await synapse.download(testPieceCid)

      // Should return Uint8Array
      assert.isTrue(data instanceof Uint8Array)
      assert.equal(new TextDecoder().decode(data), 'test data')
    })

    it('should pass withCDN option to retriever', async () => {
      const deferred = pDefer<{ cid: string; wallet: string }>()
      const testData = new TextEncoder().encode('test data')
      server.use(
        JSONRPC({ ...presets.basic }),
        http.get<{ cid: string; wallet: string }>(`https://:wallet.calibration.filbeam.io/:cid`, async ({ params }) => {
          deferred.resolve(params)
          return HttpResponse.arrayBuffer(testData.buffer)
        }),
        http.get('https://pdp.example.com/pdp/piece', async ({ request }) => {
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')

          return HttpResponse.json({
            pieceCid,
          })
        }),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )

      const synapse = await Synapse.create({
        signer,
        withCDN: false, // Instance default
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'

      // Test with explicit withCDN
      await synapse.download(testPieceCid, { withCDN: true })
      const result = await deferred.promise

      const { cid, wallet } = result
      assert.equal(cid, testPieceCid)
      assert.ok(isAddressEqual(wallet as Address, ADDRESSES.client1))

      // Test without explicit withCDN (should use instance default)
      const data = await synapse.download(testPieceCid)
      assert.isTrue(data instanceof Uint8Array)
      assert.equal(new TextDecoder().decode(data), 'test data')
    })

    it('should pass providerAddress option to retriever', async () => {
      let providerAddressReceived: string | undefined
      const testData = new TextEncoder().encode('test data')

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderByAddress: (data) => {
              providerAddressReceived = data[0]
              return presets.basic.serviceRegistry.getProviderByAddress(data)
            },
          },
        }),
        http.get('https://pdp.example.com/pdp/piece', async ({ request }) => {
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')

          return HttpResponse.json({
            pieceCid,
          })
        }),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )
      const synapse = await Synapse.create({
        signer,
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'
      const testProvider = '0x1234567890123456789012345678901234567890'

      await synapse.download(testPieceCid, { providerAddress: testProvider })
      assert.equal(providerAddressReceived, testProvider)
    })

    it('should handle download errors', async () => {
      server.use(
        JSONRPC(presets.basic),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.error()
        })
      )

      const synapse = await Synapse.create({
        signer,
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'

      try {
        await synapse.download(testPieceCid)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(
          error.message,
          'All provider retrieval attempts failed and no additional retriever method was configured'
        )
      }
    })
  })

  describe('getStorageInfo', () => {
    it('should return comprehensive storage information', async () => {
      server.use(JSONRPC({ ...presets.basic }))

      const synapse = await Synapse.create({ signer })
      const storageInfo = await synapse.getStorageInfo()

      // Check pricing
      assert.exists(storageInfo.pricing)
      assert.exists(storageInfo.pricing.noCDN)
      assert.exists(storageInfo.pricing.withCDN)

      // Verify pricing calculations (2 USDFC per TiB per month)
      const expectedNoCDNMonthly = parseUnits('2', 18) // 2 USDFC
      assert.equal(storageInfo.pricing.noCDN.perTiBPerMonth, expectedNoCDNMonthly)

      // Check providers
      assert.equal(storageInfo.providers.length, 2)
      assert.equal(storageInfo.providers[0].serviceProvider, ADDRESSES.serviceProvider1)
      assert.equal(storageInfo.providers[1].serviceProvider, ADDRESSES.serviceProvider2)

      // Check service parameters
      assert.equal(storageInfo.serviceParameters.network, 'calibration')
      assert.equal(storageInfo.serviceParameters.epochsPerMonth, 86400n)
      assert.equal(storageInfo.serviceParameters.epochsPerDay, 2880n)
      assert.equal(storageInfo.serviceParameters.epochDuration, 30)
      assert.equal(storageInfo.serviceParameters.minUploadSize, 127)
      assert.equal(storageInfo.serviceParameters.maxUploadSize, 200 * 1024 * 1024)

      // Check allowances
      assert.exists(storageInfo.allowances)
      assert.equal(storageInfo.allowances?.service, ADDRESSES.calibration.warmStorage)
      assert.equal(storageInfo.allowances?.rateAllowance, 1000000n)
      assert.equal(storageInfo.allowances?.lockupAllowance, 10000000n)
    })

    it('should handle missing allowances gracefully', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            operatorApprovals: () => [false, 0n, 0n, 0n, 0n, 0n],
          },
        })
      )

      const synapse = await Synapse.create({ signer })
      const storageInfo = await synapse.getStorageInfo()

      // Should still return data with null allowances
      assert.exists(storageInfo.pricing)
      assert.exists(storageInfo.providers)
      assert.exists(storageInfo.serviceParameters)
      assert.deepEqual(storageInfo.allowances, {
        service: ADDRESSES.calibration.warmStorage,
        rateAllowance: 0n,
        lockupAllowance: 0n,
        rateUsed: 0n,
        lockupUsed: 0n,
      })
    })

    it('should filter out zero address providers', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProvider: (data) => {
              if (data[0] === 1n) {
                return [
                  {
                    providerId: 1n,
                    info: {
                      serviceProvider: ADDRESSES.serviceProvider1,
                      payee: ADDRESSES.payee1,
                      isActive: true,
                      name: 'Test Provider',
                      description: 'Test Provider',
                    },
                  },
                ]
              }
              return [
                {
                  providerId: 0n,
                  info: {
                    serviceProvider: ADDRESSES.zero,
                    payee: ADDRESSES.zero,
                    isActive: false,
                    name: '',
                    description: '',
                    providerId: 0n,
                  },
                },
              ]
            },
          },
        })
      )

      const synapse = await Synapse.create({ signer })
      const storageInfo = await synapse.getStorageInfo()

      // Should filter out zero address provider
      assert.equal(storageInfo.providers.length, 1)
      assert.equal(storageInfo.providers[0].serviceProvider, ADDRESSES.serviceProvider1)
    })

    it('should handle contract call failures', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
            getServicePrice: () => {
              throw new Error('RPC error')
            },
          },
        })
      )
      try {
        const synapse = await Synapse.create({ signer })
        await synapse.getStorageInfo()
        assert.fail('Should have thrown')
      } catch (error: any) {
        // The error should bubble up from the contract call
        assert.include(error.message, 'RPC error')
      }
    })
  })
})
