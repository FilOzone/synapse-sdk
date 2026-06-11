import { fwss } from '@filoz/synapse-core/abis'
import { type Chain, calibration } from '@filoz/synapse-core/chains'
import { TerminateServicePendingError } from '@filoz/synapse-core/errors'
import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import {
  type Account,
  type Client,
  createWalletClient,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  numberToHex,
  parseUnits,
  type Transport,
  http as viemHttp,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Synapse } from '../synapse.ts'

const server = setup()

// Preset basic resolves data set 1 to provider 1
const providerServiceURL = 'https://pdp.example.com'
const terminateStatusPath = `${providerServiceURL}/pdp/data-sets/1/terminate`
const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

const confirmedStatus = {
  terminationTxHash: mockTxHash,
  txStatus: 'confirmed',
  txSuccess: true,
  fwssTerminated: true,
  serviceTerminationEpoch: 4567,
}

describe('StorageManager.terminateService', () => {
  let client: Client<Transport, Chain, Account>

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
    client = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
    })
  })

  it('should relay termination through the data set provider', async () => {
    const seenHashes: string[] = []
    let posted = false

    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic }),
      http.post(terminateStatusPath, async ({ request }) => {
        const body = (await request.json()) as { extraData: Hex }
        assert.isTrue(body.extraData.startsWith('0x'))
        posted = true
        return new HttpResponse(null, { status: 202 })
      }),
      http.get(terminateStatusPath, () => {
        return HttpResponse.json(confirmedStatus, { status: 200 })
      })
    )

    const synapse = new Synapse({ client, source: null })
    const result = await synapse.storage.terminateService({
      dataSetId: 1n,
      onSubmitted: (hash) => seenHashes.push(hash),
    })

    assert.isTrue(posted, 'should have POSTed to the provider')
    assert.deepStrictEqual(result, { txHash: mockTxHash, dataSetId: 1n, endEpoch: 4567n })
    assert.deepStrictEqual(seenHashes, [mockTxHash])
  })

  it('should reject before signing when the account cannot settle in full', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [
            parseUnits('1', 18), // funds
            parseUnits('100', 18), // lockupCurrent exceeds funds
            0n, // lockupRate
            1000000n, // lockupLastSettledAt
          ],
        },
      }),
      http.post(terminateStatusPath, () => {
        assert.fail('Should not have contacted the provider')
        return new HttpResponse(null, { status: 202 })
      })
    )

    const synapse = new Synapse({ client, source: null })
    try {
      await synapse.storage.terminateService({ dataSetId: 1n })
      assert.fail('Should have thrown')
    } catch (error) {
      assert.include((error as Error).message, 'shortfall')
    }
  })

  it('should reject a data set that is not live before contacting the provider', async () => {
    // A fully deleted (post-cleanup) data set fails liveness validation during
    // provider resolution; this is distinct from terminated-but-live, which
    // reaches the provider and maps the 409 conflict to a success result
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        pdpVerifier: {
          ...Mocks.presets.basic.pdpVerifier,
          dataSetLive: () => [false],
        },
      }),
      http.post(terminateStatusPath, () => {
        assert.fail('Should not have contacted the provider')
        return new HttpResponse(null, { status: 202 })
      })
    )

    const synapse = new Synapse({ client, source: null })
    try {
      await synapse.storage.terminateService({ dataSetId: 1n })
      assert.fail('Should have thrown')
    } catch (error) {
      assert.include((error as Error).message, 'does not exist or is not live')
    }
  })

  it('should resume tracking a pending termination we cannot re-queue', async () => {
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic }),
      http.post(terminateStatusPath, () =>
        HttpResponse.text('Data set termination is already pending or complete', { status: 409 })
      ),
      http.get(terminateStatusPath, () => HttpResponse.json(confirmedStatus, { status: 200 }))
    )

    const synapse = new Synapse({ client, source: null })
    const result = await synapse.storage.terminateService({ dataSetId: 1n })
    assert.deepStrictEqual(result, { txHash: mockTxHash, dataSetId: 1n, endEpoch: 4567n })
  })

  it('should return the termination epoch when the provider reports the service is already terminated', async () => {
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic }),
      http.post(terminateStatusPath, () =>
        HttpResponse.json({ error: 'data_set_already_terminated', serviceTerminationEpoch: 4567 }, { status: 409 })
      )
    )

    const synapse = new Synapse({ client, source: null })
    const result = await synapse.storage.terminateService({ dataSetId: 1n })
    assert.deepStrictEqual(result, { dataSetId: 1n, endEpoch: 4567n })
  })

  it('should rethrow pending when the queued termination is not trackable', async () => {
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic }),
      http.post(terminateStatusPath, () =>
        HttpResponse.text('Data set termination is already pending or complete', { status: 409 })
      ),
      // Provider-initiated termination rows are not visible via the status endpoint
      http.get(terminateStatusPath, () => HttpResponse.text('Termination not found', { status: 404 }))
    )

    const synapse = new Synapse({ client, source: null })
    try {
      await synapse.storage.terminateService({ dataSetId: 1n })
      assert.fail('Should have thrown')
    } catch (error) {
      assert.instanceOf(error, TerminateServicePendingError)
    }
  })

  it('should terminate directly on-chain when skipProvider is true', async () => {
    const dataSetId = 1n
    const endEpoch = 1300000n

    // terminateServiceSync extracts ServiceTerminated; the manager additionally
    // reads endEpoch from PDPPaymentTerminated. Receipt carries both.
    const serviceTerminatedTopics = encodeEventTopics({
      abi: fwss,
      eventName: 'ServiceTerminated',
      args: { approver: Mocks.ADDRESSES.client1, dataSetId },
    })
    const serviceTerminatedData = encodeAbiParameters(
      [
        { name: 'pdpRailId', type: 'uint256' },
        { name: 'cacheMissRailId', type: 'uint256' },
        { name: 'cdnRailId', type: 'uint256' },
      ],
      [1n, 0n, 0n]
    )
    const paymentTerminatedTopics = encodeEventTopics({
      abi: fwss,
      eventName: 'PDPPaymentTerminated',
      args: { dataSetId },
    })
    const paymentTerminatedData = encodeAbiParameters(
      [
        { name: 'endEpoch', type: 'uint256' },
        { name: 'pdpRailId', type: 'uint256' },
      ],
      [endEpoch, 1n]
    )

    const logBase = {
      address: calibration.contracts.fwss.address,
      blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      blockNumber: numberToHex(1000000n),
      transactionIndex: numberToHex(0),
      removed: false,
    }

    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        warmStorage: {
          ...Mocks.presets.basic.warmStorage,
          terminateService: () => [],
        },
        eth_getTransactionReceipt: (params) => {
          const [hash] = params
          return {
            hash,
            transactionHash: hash,
            from: Mocks.ADDRESSES.client1,
            to: calibration.contracts.fwss.address,
            contractAddress: null,
            index: 0,
            root: '0x0000000000000000000000000000000000000000000000000000000000000000',
            gasUsed: numberToHex(50000n),
            gasPrice: numberToHex(1000000000n),
            cumulativeGasUsed: numberToHex(50000n),
            effectiveGasPrice: numberToHex(1000000000n),
            logsBloom: `0x${'0'.repeat(512)}`,
            blockHash: logBase.blockHash,
            blockNumber: logBase.blockNumber,
            logs: [
              {
                ...logBase,
                topics: serviceTerminatedTopics,
                data: serviceTerminatedData,
                transactionHash: hash,
                logIndex: numberToHex(0),
              },
              {
                ...logBase,
                topics: paymentTerminatedTopics,
                data: paymentTerminatedData,
                transactionHash: hash,
                logIndex: numberToHex(1),
              },
            ],
            status: '0x1',
          }
        },
      })
    )

    const seenHashes: string[] = []
    const synapse = new Synapse({ client, source: null })
    const result = await synapse.storage.terminateService({
      dataSetId,
      skipProvider: true,
      onSubmitted: (hash) => seenHashes.push(hash),
    })

    assert.strictEqual(result.dataSetId, dataSetId)
    assert.strictEqual(result.endEpoch, endEpoch)
    assert.ok(result.txHash)
    assert.deepStrictEqual(seenHashes, [result.txHash])
  })
})
