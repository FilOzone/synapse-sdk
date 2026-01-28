import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { authorizationExpiry, authorizationExpiryCall } from '../src/session-key/authorization-expiry.ts'

describe('authorizationExpiry', () => {
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

  describe('authorizationExpiryCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = authorizationExpiryCall({
        chain: calibration,
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'CreateDataSet',
      })

      assert.equal(call.functionName, 'authorizationExpiry')
      assert.equal(call.args.length, 3)
      assert.equal(call.args[0], '0x1234567890123456789012345678901234567890')
      assert.equal(call.args[1], '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
      assert.ok(typeof call.args[2] === 'string' && call.args[2].startsWith('0x'))
      assert.equal(call.address, calibration.contracts.sessionKeyRegistry.address)
      assert.equal(call.abi, calibration.contracts.sessionKeyRegistry.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = authorizationExpiryCall({
        chain: mainnet,
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'AddPieces',
      })

      assert.equal(call.functionName, 'authorizationExpiry')
      assert.equal(call.args.length, 3)
      assert.equal(call.address, mainnet.contracts.sessionKeyRegistry.address)
      assert.equal(call.abi, mainnet.contracts.sessionKeyRegistry.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x9999999999999999999999999999999999999999'
      const call = authorizationExpiryCall({
        chain: calibration,
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'SchedulePieceRemovals',
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })

    it('should convert permission to hex correctly', () => {
      const call = authorizationExpiryCall({
        chain: calibration,
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'DeleteDataSet',
      })

      assert.ok(typeof call.args[2] === 'string')
      assert.ok(call.args[2].startsWith('0x'))
      assert.equal(call.args[2].length, 66) // 0x + 64 hex chars
    })
  })

  describe('authorizationExpiry (with mocked RPC)', () => {
    it('should fetch authorization expiry', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const expiry = await authorizationExpiry(client, {
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'CreateDataSet',
      })

      assert.equal(typeof expiry, 'bigint')
      assert.equal(expiry, 0n) // Default mock returns 0
    })

    it('should fetch authorization expiry with custom expiry value', async () => {
      const customExpiry = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
      server.use(
        JSONRPC({
          ...presets.basic,
          sessionKeyRegistry: {
            ...presets.basic.sessionKeyRegistry,
            authorizationExpiry: () => [customExpiry],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const expiry = await authorizationExpiry(client, {
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'AddPieces',
      })

      assert.equal(expiry, customExpiry)
    })

    it('should fetch authorization expiry for different permissions', async () => {
      const expiry1 = BigInt(Math.floor(Date.now() / 1000) + 7200)
      const expiry2 = BigInt(Math.floor(Date.now() / 1000) + 10800)

      let callCount = 0
      server.use(
        JSONRPC({
          ...presets.basic,
          sessionKeyRegistry: {
            ...presets.basic.sessionKeyRegistry,
            authorizationExpiry: () => {
              callCount++
              return callCount === 1 ? [expiry1] : [expiry2]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const expirySchedule = await authorizationExpiry(client, {
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'SchedulePieceRemovals',
      })

      const expiryDelete = await authorizationExpiry(client, {
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'DeleteDataSet',
      })

      assert.equal(expirySchedule, expiry1)
      assert.equal(expiryDelete, expiry2)
    })

    it('should return 0 when authorization does not exist', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          sessionKeyRegistry: {
            ...presets.basic.sessionKeyRegistry,
            authorizationExpiry: () => [0n],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const expiry = await authorizationExpiry(client, {
        address: '0x1234567890123456789012345678901234567890',
        sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        permission: 'CreateDataSet',
      })

      assert.equal(expiry, 0n)
    })
  })
})
