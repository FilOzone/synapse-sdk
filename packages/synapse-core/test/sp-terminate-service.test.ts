import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { delay, HttpResponse, http } from 'msw'
import { createWalletClient, decodeAbiParameters, type Hex, verifyTypedData, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Chains from '../src/chains.ts'
import {
  ServiceAlreadyTerminatedError,
  TerminateServiceError,
  TerminateServiceNotSupportedError,
  TerminateServicePendingError,
  WaitForTerminateServiceError,
  WaitForTerminateServiceNotFoundError,
  WaitForTerminateServiceRejectedError,
} from '../src/errors/pdp.ts'
import { PRIVATE_KEYS } from '../src/mocks/index.ts'
import {
  TimeoutError,
  terminateService,
  type terminateServiceApiRequest,
  terminateServiceApiRequest as terminateServiceApiRequestFn,
  terminateServiceStatusUrl,
  waitForTerminateService,
} from '../src/sp/index.ts'
import { EIP712Types, getStorageDomain } from '../src/typed-data/type-definitions.ts'

const account = privateKeyToAccount(PRIVATE_KEYS.key1)
const client = createWalletClient({
  account,
  chain: Chains.calibration,
  transport: viemHttp(),
})

const serviceURL = 'http://pdp.local'
const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
const mockExtraData: Hex = '0xdeadbeef'

const pendingStatus = {
  terminationTxHash: '',
  txStatus: '',
  txSuccess: null,
  fwssTerminated: false,
  serviceTerminationEpoch: null,
}

const submittedStatus = {
  terminationTxHash: mockTxHash,
  txStatus: 'pending',
  txSuccess: null,
  fwssTerminated: false,
  serviceTerminationEpoch: null,
}

const confirmedStatus = {
  terminationTxHash: mockTxHash,
  txStatus: 'confirmed',
  txSuccess: true,
  fwssTerminated: true,
  serviceTerminationEpoch: 4567,
}

describe('SP terminate service', () => {
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

  describe('terminateServiceStatusUrl', () => {
    it('should build the status URL', () => {
      assert.strictEqual(
        terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
        'http://pdp.local/pdp/data-sets/1/terminate'
      )
    })
  })

  describe('terminateServiceApiRequest', () => {
    it('should queue termination and return the status URL', async () => {
      server.use(
        http.post<never, terminateServiceApiRequest.RequestBody>(
          'http://pdp.local/pdp/data-sets/1/terminate',
          async ({ request }) => {
            const body = await request.json()
            assert.strictEqual(body.extraData, mockExtraData)
            return new HttpResponse(null, { status: 202 })
          }
        )
      )

      const result = await terminateServiceApiRequestFn({
        serviceURL,
        dataSetId: 1n,
        extraData: mockExtraData,
      })
      assert.deepStrictEqual(result, { statusUrl: 'http://pdp.local/pdp/data-sets/1/terminate' })
    })

    it('should throw DataSetAlreadyTerminatedError on 409 with conflict body', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.json(
            { error: 'data_set_already_terminated', serviceTerminationEpoch: 12345 },
            { status: 409 }
          )
        })
      )

      try {
        await terminateServiceApiRequestFn({ serviceURL, dataSetId: 1n, extraData: mockExtraData })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, ServiceAlreadyTerminatedError)
        assert.strictEqual(error.endEpoch, 12345n)
      }
    })

    it('should throw TerminateServicePendingError on 409 with plain text body', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.text('Data set termination is already pending or complete', { status: 409 })
        })
      )

      try {
        await terminateServiceApiRequestFn({ serviceURL, dataSetId: 1n, extraData: mockExtraData })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, TerminateServicePendingError)
      }
    })

    it('should throw TerminateServiceNotSupportedError on 503', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.text('FWSS contract does not support client-requested termination', { status: 503 })
        })
      )

      try {
        await terminateServiceApiRequestFn({ serviceURL, dataSetId: 1n, extraData: mockExtraData })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, TerminateServiceNotSupportedError)
      }
    })

    it('should throw TerminateServiceError on other errors', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.text('Data set not found', { status: 404 })
        })
      )

      try {
        await terminateServiceApiRequestFn({ serviceURL, dataSetId: 1n, extraData: mockExtraData })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, TerminateServiceError)
        assert.include(error.message, 'Failed to request data set termination')
      }
    })
  })

  describe('terminateService', () => {
    it('should sign the authorization and post it', async () => {
      server.use(
        http.post<never, terminateServiceApiRequest.RequestBody>(
          'http://pdp.local/pdp/data-sets/1/terminate',
          async ({ request }) => {
            const body = await request.json()
            const [signature] = decodeAbiParameters([{ type: 'bytes' }], body.extraData)
            const valid = await verifyTypedData({
              address: account.address,
              domain: getStorageDomain({ chain: Chains.calibration }),
              types: EIP712Types,
              primaryType: 'TerminateService',
              message: { dataSetId: 1n },
              signature: signature as Hex,
            })
            assert.isTrue(valid, 'extraData should carry a valid TerminateService signature')
            return new HttpResponse(null, { status: 202 })
          }
        )
      )

      const result = await terminateService(client, { serviceURL, dataSetId: 1n })
      assert.deepStrictEqual(result, { statusUrl: 'http://pdp.local/pdp/data-sets/1/terminate' })
    })

    it('should use pre-built extraData when provided', async () => {
      server.use(
        http.post<never, terminateServiceApiRequest.RequestBody>(
          'http://pdp.local/pdp/data-sets/1/terminate',
          async ({ request }) => {
            const body = await request.json()
            assert.strictEqual(body.extraData, mockExtraData)
            return new HttpResponse(null, { status: 202 })
          }
        )
      )

      await terminateService(client, { serviceURL, dataSetId: 1n, extraData: mockExtraData })
    })
  })

  describe('waitForTerminateService', () => {
    it('should resolve when termination is confirmed', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.json(confirmedStatus, { status: 200 })
        })
      )

      const result = await waitForTerminateService({
        statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
      })
      assert.strictEqual(result.fwssTerminated, true)
      assert.strictEqual(result.terminationTxHash, mockTxHash)
      assert.strictEqual(result.serviceTerminationEpoch, 4567n)
    })

    it('should poll pending then confirmed and report the tx hash once', async () => {
      let callCount = 0
      const seenHashes: string[] = []

      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', () => {
          callCount++
          if (callCount === 1) {
            return HttpResponse.json(pendingStatus, { status: 200 })
          }
          if (callCount === 2) {
            return HttpResponse.json(submittedStatus, { status: 200 })
          }
          return HttpResponse.json(confirmedStatus, { status: 200 })
        })
      )

      const result = await waitForTerminateService({
        statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
        pollInterval: 10,
        onHash: (hash) => seenHashes.push(hash),
      })
      assert.strictEqual(result.serviceTerminationEpoch, 4567n)
      assert.isTrue(callCount >= 3, 'Should have polled at least three times')
      assert.deepStrictEqual(seenHashes, [mockTxHash], 'onTxHash should fire exactly once')
    })

    it('should resolve when terminated without a provider transaction', async () => {
      // A competing terminate landed between our 202 and the SP's relay; the SP completes the request without sending a tx
      const seenHashes: string[] = []
      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.json(
            { ...confirmedStatus, terminationTxHash: '', txStatus: '', txSuccess: null },
            { status: 200 }
          )
        })
      )

      const result = await waitForTerminateService({
        statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
        onHash: (hash) => seenHashes.push(hash),
      })
      assert.strictEqual(result.terminationTxHash, '')
      assert.strictEqual(result.serviceTerminationEpoch, 4567n)
      assert.deepStrictEqual(seenHashes, [], 'onTxHash should not fire without a hash')
    })

    it('should resolve when our transaction reverted but a competing terminate won', async () => {
      // The SP advances the pipeline when the data set is terminated on chain
      // despite the relayed tx failing; fwssTerminated wins over txSuccess.
      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.json({ ...confirmedStatus, txSuccess: false }, { status: 200 })
        })
      )

      const result = await waitForTerminateService({
        statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
      })
      assert.strictEqual(result.fwssTerminated, true)
      assert.strictEqual(result.serviceTerminationEpoch, 4567n)
    })

    it('should throw rejected error when the transaction failed', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.json({ ...submittedStatus, txStatus: 'confirmed', txSuccess: false }, { status: 200 })
        })
      )

      try {
        await waitForTerminateService({
          statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
        })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, WaitForTerminateServiceRejectedError)
        assert.strictEqual(error.response.terminationTxHash, mockTxHash)
      }
    })

    it('should throw rejected error when the transaction status is failed', async () => {
      const seenHashes: string[] = []
      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.json({ ...submittedStatus, txStatus: 'failed' }, { status: 200 })
        })
      )

      try {
        await waitForTerminateService({
          statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
          onHash: (hash) => seenHashes.push(hash),
        })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, WaitForTerminateServiceRejectedError)
        assert.strictEqual(error.response.terminationTxHash, mockTxHash)
        assert.deepStrictEqual(seenHashes, [mockTxHash])
      }
    })

    it('should throw not-found error on 404', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.text('Termination not found', { status: 404 })
        })
      )

      try {
        await waitForTerminateService({
          statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
          retryCount: 0,
        })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, WaitForTerminateServiceNotFoundError)
      }
    })

    it('should throw wait error on server error', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', () => {
          return HttpResponse.text('Database error', { status: 500 })
        })
      )

      try {
        await waitForTerminateService({
          statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
          retryDelay: 10,
        })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.instanceOf(error, WaitForTerminateServiceError)
        assert.include(error.message, 'Failed to wait for data set termination')
      }
    })

    it('should handle timeout', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/1/terminate', async () => {
          await delay(150)
          return HttpResponse.json(confirmedStatus, { status: 200 })
        })
      )

      try {
        await waitForTerminateService({
          statusUrl: terminateServiceStatusUrl({ serviceURL, dataSetId: 1n }),
          timeout: 50,
        })
        assert.fail('Should have thrown timeout error')
      } catch (error) {
        assert.instanceOf(error, TimeoutError)
      }
    })
  })
})
