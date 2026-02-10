/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import * as Piece from '@filoz/synapse-core/piece'
import { getPermissionFromTypeHash, type SessionKeyPermissions } from '@filoz/synapse-core/session-key'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import pDefer from 'p-defer'
import { type Address, createWalletClient, isAddressEqual, parseUnits, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PaymentsService } from '../payments/index.ts'
import type { StorageContext } from '../storage/context.ts'
import { Synapse } from '../synapse.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'

// mock server for testing
const server = setup()

const providers = [Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]
const providerIds = providers.map((provider) => provider.providerId)
const account = privateKeyToAccount(Mocks.PRIVATE_KEYS.key1)
const client = createWalletClient({
  chain: calibration,
  transport: viemHttp(),
  account,
})

describe('Synapse', () => {
  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })
  beforeEach(() => {
    server.resetHandlers()
  })

  describe('StorageManager access', () => {
    it('should provide access to StorageManager via synapse.storage', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const synapse = Synapse.create({
        chain: calibration,
        account,
      })

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
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const synapse = new Synapse({
        client,
        withCDN: true,
      })

      assert.exists(synapse.storage)
      // The storage manager should inherit the withCDN setting
      // We can't directly test this without accessing private properties
      // but it will be used in upload/download operations
    })

    it('should return same storage manager instance', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const synapse = new Synapse({ client })

      const storage1 = synapse.storage
      const storage2 = synapse.storage

      // Should be the same instance
      assert.equal(storage1, storage2)
    })
  })

  // describe('Session Keys', () => {
  //   const FAKE_TX_HASH = '0x3816d82cb7a6f5cde23f4d63c0763050d13c6b6dc659d0a7e6eba80b0ec76a18'
  //   const FAKE_TX = {
  //     hash: FAKE_TX_HASH,
  //     from: Mocks.ADDRESSES.serviceProvider1,
  //     gas: '0x5208',
  //     value: '0x0',
  //     nonce: '0x444',
  //     input: '0x',
  //     v: '0x01',
  //     r: '0x4e2eef88cc6f2dc311aa3b1c8729b6485bd606960e6ae01522298278932c333a',
  //     s: '0x5d0e08d8ecd6ed8034aa956ff593de9dc1d392e73909ef0c0f828918b58327c9',
  //   }
  //   const FAKE_RECEIPT = {
  //     ...FAKE_TX,
  //     transactionHash: FAKE_TX_HASH,
  //     transactionIndex: '0x10',
  //     blockHash: '0xb91b7314248aaae06f080ad427dbae78b8c5daf72b2446cf843739aef80c6417',
  //     status: '0x1',
  //     blockNumber: '0x127001',
  //     cumulativeGasUsed: '0x52080',
  //     gasUsed: '0x5208',
  //   }
  //   beforeEach(() => {
  //     const pdpOptions: Mocks.PingMockOptions = {
  //       baseUrl: 'https://pdp.example.com',
  //     }
  //     server.use(Mocks.PING(pdpOptions))
  //   })

  //   it('should storage.createContext with session key', async () => {
  //     const signerAddress = client.account.address
  //     const sessionKeySigner = new ethers.Wallet(Mocks.PRIVATE_KEYS.key2)
  //     const sessionKeyAddress = await sessionKeySigner.getAddress()
  //     const EXPIRY = BigInt(1757618883)
  //     server.use(
  //       Mocks.JSONRPC({
  //         ...Mocks.presets.basic,
  //         sessionKeyRegistry: {
  //           authorizationExpiry: (args) => {
  //             const client = args[0]
  //             const signer = args[1]
  //             assert.equal(client, signerAddress)
  //             assert.equal(signer, sessionKeyAddress)
  //             const permission = args[2]
  //             assert.isTrue(PDP_PERMISSIONS.includes(permission))
  //             return [EXPIRY]
  //           },
  //         },
  //         payments: {
  //           ...Mocks.presets.basic.payments,
  //           operatorApprovals: ([token, client, operator]) => {
  //             assert.equal(token, Mocks.ADDRESSES.calibration.usdfcToken)
  //             assert.equal(client, signerAddress)
  //             assert.equal(operator, Mocks.ADDRESSES.calibration.warmStorage)
  //             return [
  //               true, // isApproved
  //               BigInt(127001 * 635000000), // rateAllowance
  //               BigInt(127001 * 635000000), // lockupAllowance
  //               BigInt(0), // rateUsage
  //               BigInt(0), // lockupUsage
  //               BigInt(28800), // maxLockupPeriod
  //             ]
  //           },
  //           accounts: ([token, user]) => {
  //             assert.equal(user, signerAddress)
  //             assert.equal(token, Mocks.ADDRESSES.calibration.usdfcToken)
  //             return [BigInt(127001 * 635000000), BigInt(0), BigInt(0), BigInt(0)]
  //           },
  //         },
  //         eth_getTransactionByHash: (params) => {
  //           const hash = params[0]
  //           assert.equal(hash, FAKE_TX_HASH)
  //           return FAKE_TX
  //         },
  //         eth_getTransactionReceipt: (params) => {
  //           const hash = params[0]
  //           assert.equal(hash, FAKE_TX_HASH)
  //           return FAKE_RECEIPT
  //         },
  //       })
  //     )
  //     const synapse = await Synapse.create({ client })
  //     const sessionKey = synapse.createSessionKey(sessionKeySigner)
  //     synapse.setSession(sessionKey)
  //     assert.equal(sessionKey.getSigner(), sessionKeySigner)

  //     const expiries = await sessionKey.fetchExpiries(PDP_PERMISSIONS)
  //     for (const permission of PDP_PERMISSIONS) {
  //       assert.equal(expiries[permission], EXPIRY)
  //     }

  //     const context = await synapse.storage.createContext()
  //     assert.equal((context as any)._synapse.getSigner(), sessionKeySigner)
  //     const info = await context.preflightUpload(127)
  //     assert.isTrue(info.allowanceCheck.sufficient)

  //     // Payments uses the original signer
  //     const accountInfo = await synapse.payments.accountInfo()
  //     assert.equal(accountInfo.funds, BigInt(127001 * 635000000))
  //   })
  // })

  describe('Payment access', () => {
    it('should provide read-only access to payments', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const synapse = new Synapse({ client })

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
      server.use(Mocks.JSONRPC(Mocks.presets.basic))

      const synapse = new Synapse({ client })
      const providerInfo = await synapse.getProviderInfo(Mocks.ADDRESSES.serviceProvider1)

      assert.ok(isAddressEqual(providerInfo.serviceProvider as Address, Mocks.ADDRESSES.serviceProvider1))
      assert.equal(providerInfo.pdp.serviceURL, 'https://pdp.example.com')
    })

    it('should throw for invalid provider address', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const synapse = new Synapse({ client })

      try {
        // @ts-expect-error - invalid address
        await synapse.getProviderInfo('invalid-address')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Address "invalid-address" is invalid')
      }
    })

    it('should throw for non-found provider', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: true,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
          },
        })
      )

      try {
        const synapse = new Synapse({ client })
        await synapse.getProviderInfo(Mocks.ADDRESSES.zero)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not found in registry')
      }
    })

    it('should throw when provider not found', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
          },
        })
      )

      try {
        const synapse = new Synapse({ client })
        await synapse.getProviderInfo(Mocks.ADDRESSES.zero)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not found')
      }
    })
  })

  describe('download', () => {
    it('should validate PieceCID input', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const synapse = new Synapse({ client })

      try {
        await synapse.storage.download({ pieceCid: 'invalid-piece-link' })
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
        Mocks.JSONRPC(Mocks.presets.basic),
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

      const synapse = new Synapse({ client })

      // Use the actual PieceCID for 'test data'
      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'
      const data = await synapse.storage.download({ pieceCid: testPieceCid })

      // Should return Uint8Array
      assert.isTrue(data instanceof Uint8Array)
      assert.equal(new TextDecoder().decode(data), 'test data')
    })

    it('should pass withCDN option to retriever', async () => {
      const deferred = pDefer<{ cid: string; wallet: string }>()
      const testData = new TextEncoder().encode('test data')
      server.use(
        Mocks.JSONRPC({ ...Mocks.presets.basic }),
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

      const synapse = new Synapse({
        client,
        withCDN: false, // Instance default
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'

      // Test with explicit withCDN
      await synapse.storage.download({ pieceCid: testPieceCid, withCDN: true })
      const result = await deferred.promise

      const { cid, wallet } = result
      assert.equal(cid, testPieceCid)
      assert.ok(isAddressEqual(wallet as Address, Mocks.ADDRESSES.client1))

      // Test without explicit withCDN (should use instance default)
      const data = await synapse.storage.download({ pieceCid: testPieceCid })
      assert.isTrue(data instanceof Uint8Array)
      assert.equal(new TextDecoder().decode(data), 'test data')
    })

    it('should pass providerAddress option to retriever', async () => {
      let providerAddressReceived: string | undefined
      const testData = new TextEncoder().encode('test data')

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: false,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
            getProviderIdByAddress: (data) => {
              providerAddressReceived = data[0]
              return [1n]
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
      const synapse = new Synapse({
        client,
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'
      const testProvider = '0x1234567890123456789012345678901234567890'

      await synapse.storage.download({ pieceCid: testPieceCid, providerAddress: testProvider })
      assert.equal(providerAddressReceived, testProvider)
    })

    it('should handle download errors', async () => {
      server.use(
        Mocks.JSONRPC(Mocks.presets.basic),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.error()
        })
      )

      const synapse = new Synapse({
        client,
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'

      try {
        await synapse.storage.download({ pieceCid: testPieceCid })
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
      server.use(Mocks.JSONRPC({ ...Mocks.presets.basic }))

      const synapse = new Synapse({ client })
      const storageInfo = await synapse.storage.getStorageInfo()

      // Check pricing
      assert.exists(storageInfo.pricing)
      assert.exists(storageInfo.pricing.noCDN)
      assert.exists(storageInfo.pricing.withCDN)

      // Verify pricing calculations (2 USDFC per TiB per month)
      const expectedNoCDNMonthly = parseUnits('2', 18) // 2 USDFC
      assert.equal(storageInfo.pricing.noCDN.perTiBPerMonth, expectedNoCDNMonthly)

      // Check providers
      assert.equal(storageInfo.providers.length, 2)
      assert.equal(storageInfo.providers[0].serviceProvider, Mocks.ADDRESSES.serviceProvider1)
      assert.equal(storageInfo.providers[1].serviceProvider, Mocks.ADDRESSES.serviceProvider2)

      // Check service parameters
      assert.equal(storageInfo.serviceParameters.epochsPerMonth, 86400n)
      assert.equal(storageInfo.serviceParameters.epochsPerDay, 2880n)
      assert.equal(storageInfo.serviceParameters.epochDuration, 30)
      assert.equal(storageInfo.serviceParameters.minUploadSize, 127)
      assert.equal(storageInfo.serviceParameters.maxUploadSize, SIZE_CONSTANTS.MAX_UPLOAD_SIZE)

      // Check allowances (including operator approval flag)
      assert.exists(storageInfo.allowances)
      assert.equal(storageInfo.allowances?.isApproved, true)
      assert.equal(storageInfo.allowances?.service, Mocks.ADDRESSES.calibration.warmStorage)
      assert.equal(storageInfo.allowances?.rateAllowance, 1000000n)
      assert.equal(storageInfo.allowances?.lockupAllowance, 10000000n)
    })

    it('should handle missing allowances gracefully', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          payments: {
            operatorApprovals: () => [false, 0n, 0n, 0n, 0n, 0n],
          },
        })
      )

      const synapse = new Synapse({ client })
      const storageInfo = await synapse.storage.getStorageInfo()

      // Should still return data with null allowances
      assert.exists(storageInfo.pricing)
      assert.exists(storageInfo.providers)
      assert.exists(storageInfo.serviceParameters)
      assert.deepEqual(storageInfo.allowances, {
        isApproved: false,
        service: Mocks.ADDRESSES.calibration.warmStorage,
        rateAllowance: 0n,
        lockupAllowance: 0n,
        rateUsed: 0n,
        lockupUsed: 0n,
      })
    })

    it('should handle contract call failures', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorage: {
            ...Mocks.presets.basic.warmStorage,
            getServicePrice: () => {
              throw new Error('RPC error')
            },
          },
        })
      )
      try {
        const synapse = new Synapse({ client })
        await synapse.storage.getStorageInfo()
        assert.fail('Should have thrown')
      } catch (error: any) {
        // The error should bubble up from the contract call
        assert.include(error.message, 'RPC error')
      }
    })
  })

  describe('createContexts', () => {
    let synapse: Synapse
    const endorsedProviderIds: bigint[] = []

    beforeEach(async () => {
      endorsedProviderIds.length = 0
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
          endorsements: {
            getProviderIds: () => [endorsedProviderIds],
          },
        })
      )
      synapse = new Synapse({ client })
      for (const { products } of [Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]) {
        server.use(
          Mocks.PING({
            baseUrl: products[0].offering.serviceURL,
          })
        )
      }
    })

    it('selects specified providerIds', async () => {
      const contexts = await synapse.storage.createContexts({
        providerIds: [Mocks.PROVIDERS.provider1.providerId, Mocks.PROVIDERS.provider2.providerId],
      })
      assert.equal(contexts.length, 2)
      assert.equal(BigInt(contexts[0].provider.id), Mocks.PROVIDERS.provider1.providerId)
      assert.equal(BigInt(contexts[1].provider.id), Mocks.PROVIDERS.provider2.providerId)
      // should create new data sets
      assert.equal((contexts[0] as any)._dataSetId, undefined)
      assert.equal((contexts[1] as any)._dataSetId, undefined)
    })

    it('uses existing data set specified by providerId when metadata matches', async () => {
      const metadata = {
        environment: 'test',
        withCDN: '',
      }
      const contexts = await synapse.storage.createContexts({
        providerIds: [Mocks.PROVIDERS.provider1.providerId],
        metadata,
        count: 1,
      })
      assert.equal(contexts.length, 1)
      assert.equal(BigInt(contexts[0].provider.id), Mocks.PROVIDERS.provider1.providerId)
      // should use existing data set
      assert.equal((contexts[0] as any)._dataSetId, 1n)
    })

    it('force creates new data set specified by providerId even when metadata matches', async () => {
      const metadata = {
        withCDN: '',
      }
      const contexts = await synapse.storage.createContexts({
        providerIds: [Mocks.PROVIDERS.provider1.providerId],
        metadata,
        count: 1,
        forceCreateDataSets: true,
      })
      assert.equal(contexts.length, 1)
      assert.equal(BigInt(contexts[0].provider.id), Mocks.PROVIDERS.provider1.providerId)
      // should create new data set
      assert.equal((contexts[0] as any)._dataSetId, undefined)
    })

    it('fails when provided an invalid providerId', async () => {
      try {
        await synapse.storage.createContexts({
          providerIds: [3n, 4n],
        })
        assert.fail('Expected createContexts to fail for invalid specified providerIds')
      } catch (error: any) {
        assert.include(error.message, 'Provider ID 3 not found in registry')
      }
    })

    it('selects providers specified by data set id', async () => {
      const contexts1 = await synapse.storage.createContexts({
        count: 1,
        dataSetIds: [1n],
      })
      assert.equal(contexts1.length, 1)
      assert.equal(contexts1[0].provider.id, 1n)
      assert.equal((contexts1[0] as any)._dataSetId, 1n)
    })

    it('fails when provided an invalid data set id', async () => {
      // Test dataSetId 0: should fail with "does not exist" (pdpRailId is 0)
      try {
        await synapse.storage.createContexts({
          count: 1,
          dataSetIds: [0n],
        })
        assert.fail('Expected createContexts to fail for data set id 0')
      } catch (error: any) {
        assert.include(error?.message, 'Data set 0 does not exist')
      }

      // Test dataSetId 2: should fail (not in mock data, so pdpRailId will be 0)
      try {
        await synapse.storage.createContexts({
          count: 1,
          dataSetIds: [2n],
        })
        assert.fail('Expected createContexts to fail for data set id 2')
      } catch (error: any) {
        assert.include(error?.message, 'Data set 2 does not exist')
      }
    })

    it('does not create multiple contexts for the same data set from duplicate dataSetIds', async () => {
      const metadata = {
        environment: 'test',
        withCDN: '',
      }
      const contexts = await synapse.storage.createContexts({
        count: 2,
        dataSetIds: [1n, 1n],
        metadata,
      })
      assert.equal(contexts.length, 2)
      assert.equal((contexts[0] as any)._dataSetId, 1)
      assert.notEqual((contexts[0] as any)._dataSetId, (contexts[1] as any)._dataSetId)
      // should also use different providers in this case
      assert.notEqual(contexts[0].provider.id, contexts[1].provider.id)
    })

    it('does not create multiple contexts for the same data set from duplicate providerIds', async () => {
      const metadata = {
        environment: 'test',
        withCDN: '',
      }
      const contexts = await synapse.storage.createContexts({
        count: 2,
        providerIds: [Mocks.PROVIDERS.provider1.providerId, Mocks.PROVIDERS.provider1.providerId],
        metadata,
      })
      assert.equal(contexts.length, 2)
      assert.equal((contexts[0] as any)._dataSetId, 1)
      assert.notEqual((contexts[0] as any)._dataSetId, (contexts[1] as any)._dataSetId)
    })

    it('does not create multiple contexts for a specified data set when providerId also provided', async () => {
      const metadata = {
        environment: 'test',
        withCDN: '',
      }
      const contexts = await synapse.storage.createContexts({
        count: 2,
        dataSetIds: [1n, 1n],
        providerIds: [Mocks.PROVIDERS.provider1.providerId, Mocks.PROVIDERS.provider1.providerId],
        metadata,
      })
      assert.equal(contexts.length, 2)
      assert.equal((contexts[0] as any)._dataSetId, 1)
      assert.notEqual((contexts[0] as any)._dataSetId, (contexts[1] as any)._dataSetId)
    })

    it('selects existing data set by default when metadata matches', async () => {
      const metadata = {
        environment: 'test',
        withCDN: '',
      }
      const contexts = await synapse.storage.createContexts({
        count: 1,
        metadata,
      })
      assert.equal(contexts.length, 1)
      assert.equal(contexts[0].provider.id, 1n)
      assert.equal((contexts[0] as any)._dataSetId, 1n)
    })

    it('avoids existing data set when provider is excluded even when metadata matches', async () => {
      const metadata = {
        environment: 'test',
        withCDN: '',
      }
      const contexts = await synapse.storage.createContexts({
        count: 1,
        metadata,
        excludeProviderIds: [1n],
      })
      assert.equal(contexts.length, 1)
      assert.notEqual(contexts[0].provider.id, 1n)
    })

    it('creates new data set context when forced even when metadata matches', async () => {
      const metadata = {
        environment: 'test',
        withCDN: '',
      }
      const contexts = await synapse.storage.createContexts({
        count: 1,
        metadata,
        forceCreateDataSets: true,
      })
      assert.equal(contexts.length, 1)
      assert.equal((contexts[0] as any)._dataSetId, undefined)
    })

    it('can select new data sets from different providers using default params', async () => {
      const contexts = await synapse.storage.createContexts()
      assert.equal(contexts.length, 2)
      assert.equal((contexts[0] as any)._dataSetId, undefined)
      assert.equal((contexts[1] as any)._dataSetId, undefined)
      assert.notEqual(contexts[0].provider.id, contexts[1].provider.id)

      // should return the same contexts when invoked again
      const defaultContexts = await synapse.storage.createContexts()
      assert.isTrue(defaultContexts === contexts)
    })

    providerIds.forEach((endorsedProviderId, index) => {
      describe(`when endorsing providers[${index}]`, async () => {
        beforeEach(() => {
          endorsedProviderIds.push(BigInt(endorsedProviderId))
        })

        it('falls back to other provider when endorsed provider fails ping', async () => {
          // mock ping to fail for endorsed provider
          const endorsedProvider = providers[index]
          server.use(
            http.get(`${endorsedProvider.products[0].offering.serviceURL}/pdp/ping`, () => HttpResponse.error())
          )

          const contexts = await synapse.storage.createContexts({
            count: 1,
            forceCreateDataSets: true,
          })
          assert.equal(contexts.length, 1)
          assert.equal((contexts[0] as any)._dataSetId, undefined)

          const otherProviderId = providerIds[providers.length - index - 1]
          assert.equal(contexts[0].provider.id, otherProviderId)
        })

        for (const count of [1, 2]) {
          it(`prefers to select the endorsed context when selecting ${count} providers`, async () => {
            const counts: Record<string, number> = {}
            for (const providerId of providerIds) {
              counts[providerId.toString()] = 0
            }
            for (let i = 0; i < 5; i++) {
              const contexts = await synapse.storage.createContexts({
                count,
                forceCreateDataSets: true, // This prevents the defaultContexts caching
              })
              assert.equal(contexts.length, count)
              assert.equal((contexts[0] as any)._dataSetId, undefined)
              counts[contexts[0].provider.id.toString()]++
              if (count > 1) {
                assert.notEqual(contexts[0].provider.id, contexts[1].provider.id)
                assert.equal((contexts[1] as any)._dataSetId, undefined)
              }
            }
            for (const providerId of providerIds) {
              assert.equal(counts[providerId.toString()], providerId === endorsedProviderId ? 5 : 0)
            }
          })
        }
      })
    })

    it('can attempt to create numerous contexts, returning fewer', async () => {
      const contexts = await synapse.storage.createContexts({
        count: 100,
      })
      assert.equal(contexts.length, 2)
      assert.notEqual(contexts[0].provider.id, contexts[1].provider.id)
    })

    describe('upload', () => {
      let contexts: StorageContext[]
      const FAKE_TX_HASH = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      const DATA_SET_ID = 7
      beforeEach(async () => {
        contexts = await synapse.storage.createContexts({
          providerIds: [1n, 2n],
        })
        for (const provider of [Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]) {
          const pdpOptions: Mocks.pdp.PDPMockOptions = {
            baseUrl: provider.products[0].offering.serviceURL,
          }
          server.use(
            Mocks.pdp.dataSetCreationStatusHandler(
              FAKE_TX_HASH,
              {
                ok: true,
                dataSetId: DATA_SET_ID,
                createMessageHash: FAKE_TX_HASH,
                dataSetCreated: true,
                service: '',
                txStatus: 'confirmed',
              },
              pdpOptions
            )
          )
        }
      })

      it('succeeds for ArrayBuffer data when upload found', async () => {
        const data = new Uint8Array(1024)
        const pieceCid = Piece.calculate(data)
        const mockUUID = '12345678-90ab-cdef-1234-567890abcdef'
        const found = true
        for (const provider of [Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]) {
          const pdpOptions = {
            baseUrl: provider.products[0].offering.serviceURL,
          }
          server.use(Mocks.pdp.postPieceUploadsHandler(mockUUID, pdpOptions))
          server.use(Mocks.pdp.uploadPieceStreamingHandler(mockUUID, pdpOptions))
          server.use(Mocks.pdp.finalizePieceUploadHandler(mockUUID, pieceCid.toString(), pdpOptions))
          server.use(Mocks.pdp.findPieceHandler(pieceCid.toString(), found, pdpOptions))
          server.use(Mocks.pdp.createAndAddPiecesHandler(FAKE_TX_HASH, pdpOptions))
          server.use(
            Mocks.pdp.pieceAdditionStatusHandler(
              DATA_SET_ID,
              FAKE_TX_HASH,
              {
                txHash: FAKE_TX_HASH,
                txStatus: 'confirmed',
                dataSetId: DATA_SET_ID,
                pieceCount: 1,
                addMessageOk: true,
                piecesAdded: true,
                confirmedPieceIds: [0],
              },
              pdpOptions
            )
          )
        }
        const result = await synapse.storage.upload(data, { contexts })
        assert.equal(result.pieceCid.toString(), pieceCid.toString())
        assert.equal(result.size, 1024)
      })

      it('fails when one storage provider returns wrong pieceCid', async () => {
        const data = new Uint8Array(1024)
        const pieceCid = Piece.calculate(data)
        const mockUUID = '12345678-90ab-cdef-1234-567890abcdef'
        const found = true
        const wrongCid = 'wrongCid'
        for (const provider of [Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]) {
          const pdpOptions = {
            baseUrl: provider.products[0].offering.serviceURL,
          }
          server.use(Mocks.pdp.postPieceUploadsHandler(mockUUID, pdpOptions))
          server.use(Mocks.pdp.uploadPieceStreamingHandler(mockUUID, pdpOptions))
          server.use(
            Mocks.pdp.finalizePieceUploadHandler(
              mockUUID,
              provider === Mocks.PROVIDERS.provider1 ? pieceCid.toString() : wrongCid,
              pdpOptions
            )
          )
          server.use(Mocks.pdp.findPieceHandler(pieceCid.toString(), found, pdpOptions))
          server.use(Mocks.pdp.createAndAddPiecesHandler(FAKE_TX_HASH, pdpOptions))
          server.use(
            Mocks.pdp.pieceAdditionStatusHandler(
              DATA_SET_ID,
              FAKE_TX_HASH,
              {
                txHash: FAKE_TX_HASH,
                txStatus: 'pending',
                dataSetId: DATA_SET_ID,
                pieceCount: 1,
                addMessageOk: true,
                piecesAdded: true,
                confirmedPieceIds: [0],
              },
              pdpOptions
            )
          )
        }
        try {
          await synapse.storage.upload(data, { contexts })
          assert.fail('Expected upload to fail when one provider returns wrong pieceCid')
        } catch (error: any) {
          assert.include(error.message, 'Failed to create upload session')
        }
      })
    })
  })
})
