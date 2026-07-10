import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { getContract } from '../src/pdp-verifier/index.ts'

describe('PDPVerifier.getContract', () => {
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

  it('uses an accountless client for reads and preserves the account for simulations', async () => {
    server.use(JSONRPC(presets.basic))

    const requestBodies: Array<{
      method: string
      params: [{ from?: string }]
    }> = []
    const client = createWalletClient({
      account: privateKeyToAccount(PRIVATE_KEYS.key1),
      chain: calibration,
      transport: http(undefined, {
        onFetchRequest(_request, init) {
          if (typeof init.body === 'string') {
            requestBodies.push(JSON.parse(init.body) as (typeof requestBodies)[number])
          }
        },
      }),
    })
    const contract = getContract({ client })

    assert.equal(await contract.read.dataSetLive([1n]), true)
    await assert.rejects(contract.simulate.renounceOwnership())
    assert.equal(client.account.address, ADDRESSES.client1)

    const calls = requestBodies.filter(({ method }) => method === 'eth_call')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].params[0].from, undefined)
    assert.equal(calls[1].params[0].from?.toLowerCase(), client.account.address.toLowerCase())
  })
})
