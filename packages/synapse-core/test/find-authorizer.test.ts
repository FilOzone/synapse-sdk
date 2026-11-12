import assert from 'assert'
import { setup } from 'iso-web/msw'
import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  http,
  numberToHex,
} from 'viem'
import * as Abis from '../src/abis/index.ts'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { findAuthorizer } from '../src/session-key/find-authorizer.ts'
import { CreateDataSetPermission } from '../src/session-key/permissions.ts'

const SIGNER: Address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const OTHER_SIGNER: Address = '0x1111111111111111111111111111111111111111'
const ROOT_A: Address = '0x2222222222222222222222222222222222222222'
const ROOT_B: Address = '0x3333333333333333333333333333333333333333'

type MockEvent = { block: bigint; identity: Address; signer: Address; expiry: bigint }

function toRpcLog(event: MockEvent, index: number) {
  const topics = encodeEventTopics({
    abi: Abis.sessionKeyRegistry,
    eventName: 'AuthorizationsUpdated',
    args: { identity: event.identity },
  })
  const data = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32[]' }, { type: 'string' }],
    [event.signer, event.expiry, [CreateDataSetPermission], 'synapse']
  )
  return {
    address: ADDRESSES.calibration.sessionKeyRegistry,
    blockHash: `0x${'aa'.repeat(32)}` as Hex,
    blockNumber: numberToHex(event.block),
    data,
    logIndex: numberToHex(index),
    removed: false,
    topics: topics as [Hex, ...Hex[]],
    transactionHash: `0x${'bb'.repeat(32)}` as Hex,
    transactionIndex: '0x0' as Hex,
  }
}

function mockLogs(events: MockEvent[], requests: Array<[bigint, bigint]>) {
  return ([filter]: [{ fromBlock?: Hex | string; toBlock?: Hex | string }]) => {
    const from = BigInt(filter.fromBlock as Hex)
    const to = BigInt(filter.toBlock as Hex)
    requests.push([from, to])
    return events.filter((e) => e.block >= from && e.block <= to).map(toRpcLog)
  }
}

describe('findAuthorizer', () => {
  const server = setup()
  const client = createPublicClient({ chain: calibration, transport: http() })

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  it('scans newest-first in windows and returns the matching identity', async () => {
    const requests: Array<[bigint, bigint]> = []
    const events: MockEvent[] = [
      { block: 105n, identity: ROOT_A, signer: SIGNER, expiry: 1000n },
      { block: 130n, identity: ROOT_B, signer: OTHER_SIGNER, expiry: 1000n },
    ]
    server.use(JSONRPC({ ...presets.basic, eth_getLogs: mockLogs(events, requests) }))

    const root = await findAuthorizer(client, { signer: SIGNER, fromBlock: 100n, toBlock: 149n, blockRange: 20n })

    assert.equal(root, ROOT_A)
    assert.deepEqual(requests, [
      [130n, 149n],
      [110n, 129n],
      [100n, 109n],
    ])
  })

  it('returns the most recent authorization and skips revocations', async () => {
    const requests: Array<[bigint, bigint]> = []
    const events: MockEvent[] = [
      { block: 101n, identity: ROOT_A, signer: SIGNER, expiry: 1000n },
      { block: 102n, identity: ROOT_B, signer: SIGNER, expiry: 2000n },
      { block: 103n, identity: ROOT_A, signer: SIGNER, expiry: 0n },
    ]
    server.use(JSONRPC({ ...presets.basic, eth_getLogs: mockLogs(events, requests) }))

    const root = await findAuthorizer(client, { signer: SIGNER, fromBlock: 100n, toBlock: 110n })

    assert.equal(root, ROOT_B)
    assert.deepEqual(requests, [[100n, 110n]])
  })

  it('matches the signer case-insensitively', async () => {
    const events: MockEvent[] = [{ block: 100n, identity: ROOT_A, signer: SIGNER, expiry: 1000n }]
    server.use(JSONRPC({ ...presets.basic, eth_getLogs: mockLogs(events, []) }))

    const root = await findAuthorizer(client, {
      signer: SIGNER.toUpperCase().replace('0X', '0x') as Address,
      fromBlock: 100n,
      toBlock: 100n,
    })

    assert.equal(root, ROOT_A)
  })

  it('defaults toBlock to the latest block and returns undefined when nothing matches', async () => {
    const requests: Array<[bigint, bigint]> = []
    server.use(JSONRPC({ ...presets.basic, eth_blockNumber: numberToHex(1000n), eth_getLogs: mockLogs([], requests) }))

    const root = await findAuthorizer(client, { signer: SIGNER, fromBlock: 500n })

    assert.equal(root, undefined)
    assert.deepEqual(requests, [
      [701n, 1000n],
      [500n, 700n],
    ])
  })

  it('throws when the signal is already aborted', async () => {
    server.use(JSONRPC({ ...presets.basic, eth_getLogs: mockLogs([], []) }))
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      findAuthorizer(client, { signer: SIGNER, fromBlock: 0n, toBlock: 10n, signal: controller.signal }),
      (error: Error) => error.name === 'AbortError'
    )
  })

  it('rejects a non-positive blockRange', async () => {
    await assert.rejects(findAuthorizer(client, { signer: SIGNER, fromBlock: 0n, toBlock: 10n, blockRange: 0n }), {
      message: '`blockRange` must be at least 1.',
    })
  })
})
