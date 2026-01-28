import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  getRailsForPayeeAndToken,
  getRailsForPayeeAndTokenCall,
  parseGetRailsForPayeeAndToken,
} from '../src/pay/get-rails-for-payee-and-token.ts'

describe('getRailsForPayeeAndToken', () => {
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

  describe('getRailsForPayeeAndTokenCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getRailsForPayeeAndTokenCall({
        chain: calibration,
        payee: ADDRESSES.client1,
        token: calibration.contracts.usdfc.address,
        offset: 0n,
        limit: 10n,
      })

      assert.equal(call.functionName, 'getRailsForPayeeAndToken')
      assert.deepEqual(call.args, [ADDRESSES.client1, calibration.contracts.usdfc.address, 0n, 10n])
      assert.equal(call.address, calibration.contracts.filecoinPay.address)
      assert.equal(call.abi, calibration.contracts.filecoinPay.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getRailsForPayeeAndTokenCall({
        chain: mainnet,
        payee: ADDRESSES.client1,
        token: mainnet.contracts.usdfc.address,
        offset: 0n,
        limit: 20n,
      })

      assert.equal(call.functionName, 'getRailsForPayeeAndToken')
      assert.deepEqual(call.args, [ADDRESSES.client1, mainnet.contracts.usdfc.address, 0n, 20n])
      assert.equal(call.address, mainnet.contracts.filecoinPay.address)
      assert.equal(call.abi, mainnet.contracts.filecoinPay.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getRailsForPayeeAndTokenCall({
        chain: calibration,
        payee: ADDRESSES.client1,
        token: calibration.contracts.usdfc.address,
        offset: 0n,
        limit: 10n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('parseGetRailsForPayeeAndToken', () => {
    it('should parse contract output tuple into named object', () => {
      const contractOutput: [Array<{ railId: bigint; isTerminated: boolean; endEpoch: bigint }>, bigint, bigint] = [
        [{ railId: 3n, isTerminated: false, endEpoch: 0n }],
        1n, // nextOffset
        1n, // total
      ]

      const result = parseGetRailsForPayeeAndToken(contractOutput)

      assert.equal(result.results.length, 1)
      assert.equal(result.results[0].railId, 3n)
      assert.equal(result.results[0].isTerminated, false)
      assert.equal(result.results[0].endEpoch, 0n)
      assert.equal(result.nextOffset, 1n)
      assert.equal(result.total, 1n)
    })
  })

  describe('getRailsForPayeeAndToken (with mocked RPC)', () => {
    it('should fetch rails for payee and token', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const result = await getRailsForPayeeAndToken(client, {
        payee: ADDRESSES.client1,
      })

      assert.equal(Array.isArray(result.results), true)
      assert.equal(typeof result.nextOffset, 'bigint')
      assert.equal(typeof result.total, 'bigint')
      assert.equal(result.results.length, 1)
      assert.equal(result.total, 2n)
    })

    it('should return expected mock values', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const result = await getRailsForPayeeAndToken(client, {
        payee: ADDRESSES.client1,
      })

      assert.equal(result.results.length, 1)
      assert.equal(result.results[0].railId, 3n)
      assert.equal(result.results[0].isTerminated, false)
      assert.equal(result.results[0].endEpoch, 0n)
      assert.equal(result.nextOffset, 2n)
      assert.equal(result.total, 2n)
    })

    it('should use custom token when provided', async () => {
      const customToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd'

      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            getRailsForPayeeAndToken: (args) => {
              // Verify the custom token is passed through
              assert.equal(args[1].toLowerCase(), customToken.toLowerCase())
              return [[{ railId: 1n, isTerminated: false, endEpoch: 0n }], 1n, 1n]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const result = await getRailsForPayeeAndToken(client, {
        payee: ADDRESSES.client1,
        token: customToken,
      })

      assert.equal(result.results.length, 1)
    })

    it('should use pagination parameters', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            getRailsForPayeeAndToken: (args) => {
              const [, , offset, limit] = args
              assert.equal(offset, 5n)
              assert.equal(limit, 10n)
              return [[{ railId: 4n, isTerminated: false, endEpoch: 0n }], 6n, 10n]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const result = await getRailsForPayeeAndToken(client, {
        payee: ADDRESSES.client1,
        offset: 5n,
        limit: 10n,
      })

      assert.equal(result.results.length, 1)
      assert.equal(result.nextOffset, 6n)
      assert.equal(result.total, 10n)
    })

    it('should use default pagination when not provided', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            getRailsForPayeeAndToken: (args) => {
              const [, , offset, limit] = args
              assert.equal(offset, 0n)
              assert.equal(limit, 0n) // 0 means get all
              return [[{ railId: 1n, isTerminated: false, endEpoch: 0n }], 1n, 1n]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const result = await getRailsForPayeeAndToken(client, {
        payee: ADDRESSES.client1,
      })

      assert.equal(result.results.length, 1)
    })
  })
})
