import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createClient, custom, encodeFunctionResult, http as viemHttp } from 'viem'
import { readContract } from 'viem/actions'
import { calibration } from '../src/chains.ts'
import { ADDRESSES } from '../src/mocks/jsonrpc/index.ts'
import { toReadClient } from '../src/utils/read-client.ts'

const valueAbi = [
  {
    type: 'function',
    name: 'value',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const encodedValue = encodeFunctionResult({
  abi: valueAbi,
  functionName: 'value',
  result: 123n,
})

describe('toReadClient', () => {
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

  it('removes the account default from eth_call without changing the source client', async () => {
    const requests: Array<{ method: string; params?: unknown }> = []
    const sourceClient = createClient({
      account: ADDRESSES.client1,
      chain: calibration,
      transport: custom({
        async request(request: { method: string; params?: unknown }) {
          requests.push(request)
          return encodedValue
        },
      }),
    })

    const readClient = toReadClient(sourceClient)
    const result = await readContract(readClient, {
      abi: valueAbi,
      address: ADDRESSES.calibration.usdfcToken,
      functionName: 'value',
    })

    assert.equal(result, 123n)
    assert.equal(sourceClient.account.address, ADDRESSES.client1)
    assert.equal(readClient.account, undefined)
    assert.equal(readClient.chain, sourceClient.chain)
    assert.equal(requests.length, 1)

    const params = requests[0].params as [{ from?: string }]
    assert.equal(params[0].from, undefined)
  })

  it('returns an existing accountless client unchanged', () => {
    const client = createClient({
      chain: calibration,
      transport: custom({ request: async () => '0x4cb2f' }),
    })

    assert.equal(toReadClient(client), client)
  })

  it('preserves a custom retry count', async () => {
    let attempts = 0
    const sourceClient = createClient({
      account: ADDRESSES.client1,
      chain: calibration,
      transport: custom(
        {
          async request() {
            attempts++
            throw Object.assign(new Error('transient failure'), { code: -1 })
          },
        },
        { retryCount: 0 }
      ),
    })

    await assert.rejects(toReadClient(sourceClient).request({ method: 'eth_chainId' }))
    assert.equal(attempts, 1)
  })

  it('preserves transport method filters', async () => {
    let attempts = 0
    const sourceClient = createClient({
      account: ADDRESSES.client1,
      chain: calibration,
      transport: custom(
        {
          async request() {
            attempts++
            return '0x4cb2f'
          },
        },
        { methods: { include: ['eth_call'] } }
      ),
    })

    await assert.rejects(toReadClient(sourceClient).request({ method: 'eth_chainId' }))
    assert.equal(attempts, 0)
  })

  it('preserves HTTP request batching and omits from in every batched call', async () => {
    const requestBodies: unknown[] = []
    server.use(
      http.post('https://read-client.test/rpc', async ({ request }) => {
        const body = (await request.json()) as Array<{
          id: number
          jsonrpc: '2.0'
          method: string
          params: [{ from?: string }]
        }>
        requestBodies.push(body)
        return HttpResponse.json(
          body.map(({ id }) => ({
            id,
            jsonrpc: '2.0' as const,
            result: encodedValue,
          }))
        )
      })
    )

    const sourceClient = createClient({
      account: ADDRESSES.client1,
      chain: calibration,
      transport: viemHttp('https://read-client.test/rpc', {
        batch: { wait: 10 },
        retryCount: 0,
      }),
    })
    const readClient = toReadClient(sourceClient)

    const results = await Promise.all([
      readContract(readClient, {
        abi: valueAbi,
        address: ADDRESSES.calibration.usdfcToken,
        functionName: 'value',
      }),
      readContract(readClient, {
        abi: valueAbi,
        address: ADDRESSES.calibration.usdfcToken,
        functionName: 'value',
      }),
    ])

    assert.deepEqual(results, [123n, 123n])
    assert.equal(requestBodies.length, 1)

    const batch = requestBodies[0] as Array<{ method: string; params: [{ from?: string }] }>
    assert.equal(batch.length, 2)
    for (const request of batch) {
      assert.equal(request.method, 'eth_call')
      assert.equal(request.params[0].from, undefined)
    }
  })
})
