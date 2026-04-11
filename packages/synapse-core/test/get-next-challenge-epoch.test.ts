import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  getNextChallengeEpoch,
  getNextChallengeEpochCall,
  parseNextChallengeEpoch,
} from '../src/pdp-verifier/get-next-challenge-epoch.ts'

describe('getNextChallengeEpoch', () => {
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

  describe('getNextChallengeEpochCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getNextChallengeEpochCall({
        chain: calibration,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getNextChallengeEpoch')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, calibration.contracts.pdp.address)
      assert.equal(call.abi, calibration.contracts.pdp.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getNextChallengeEpochCall({
        chain: mainnet,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getNextChallengeEpoch')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, mainnet.contracts.pdp.address)
      assert.equal(call.abi, mainnet.contracts.pdp.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getNextChallengeEpochCall({
        chain: calibration,
        dataSetId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getNextChallengeEpoch (with mocked RPC)', () => {
    it('should fetch the next challenge epoch', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const nextChallengeEpoch = await getNextChallengeEpoch(client, { dataSetId: 1n })

      assert.equal(nextChallengeEpoch, 5000n)
    })

    it('should return null when the contract returns a non-positive epoch', () => {
      assert.equal(parseNextChallengeEpoch(0n), null)
    })

    it('should return null when the data set is not live', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getNextChallengeEpoch: () => {
              throw new Error('Data set not live')
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const nextChallengeEpoch = await getNextChallengeEpoch(client, { dataSetId: 1n })

      assert.equal(nextChallengeEpoch, null)
    })
  })
})
