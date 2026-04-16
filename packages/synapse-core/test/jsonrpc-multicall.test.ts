import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { multicall } from 'viem/actions'
import { calibration } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getDataSetLeafCountCall } from '../src/pdp-verifier/get-data-set-leaf-count.ts'

describe('JSONRPC multicall', () => {
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

  it('should preserve mixed success and revert results for aggregate3 calls', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getDataSetLeafCount: (args) => {
            if (args[0] === 2n) {
              throw new Error('Data set not live')
            }
            return [10n]
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const results = await multicall(client, {
      allowFailure: true,
      contracts: [
        getDataSetLeafCountCall({ chain: calibration, dataSetId: 1n }),
        getDataSetLeafCountCall({ chain: calibration, dataSetId: 2n }),
      ],
    })

    assert.deepEqual(results[0], {
      status: 'success',
      result: 10n,
    })
    const failureResult = results[1]
    assert.equal(failureResult.status, 'failure')
    if (failureResult.status !== 'failure') {
      assert.fail('Expected the second multicall result to fail')
    }
    assert.equal(failureResult.result, undefined)
    assert.ok(failureResult.error.message.includes('Data set not live'))
  })
})
