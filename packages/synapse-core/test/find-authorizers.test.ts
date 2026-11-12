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
import { ValidationError } from '../src/errors/base.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { findAuthorizers } from '../src/session-key/find-authorizers.ts'
import { CreateDataSetPermission } from '../src/session-key/permissions.ts'

const SIGNER: Address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const OTHER_SIGNER: Address = '0x1111111111111111111111111111111111111111'
const ROOT_A: Address = '0x2222222222222222222222222222222222222222'
const ROOT_B: Address = '0x3333333333333333333333333333333333333333'
const ROOT_C: Address = '0x4444444444444444444444444444444444444444'

type MockEvent = { block: bigint; identity: Address; signer: Address; expiry: bigint; permissions?: Hex[] }

function txHash(block: bigint): Hex {
  return numberToHex(block, { size: 32 })
}

function toRpcLog(event: MockEvent, index: number) {
  const topics = encodeEventTopics({
    abi: Abis.sessionKeyRegistry,
    eventName: 'AuthorizationsUpdated',
    args: { identity: event.identity },
  })
  const data = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32[]' }, { type: 'string' }],
    [event.signer, event.expiry, event.permissions ?? [CreateDataSetPermission], 'synapse']
  )
  return {
    address: ADDRESSES.calibration.sessionKeyRegistry,
    blockHash: `0x${'aa'.repeat(32)}` as Hex,
    blockNumber: numberToHex(event.block),
    data,
    logIndex: numberToHex(index),
    removed: false,
    topics: topics as [Hex, ...Hex[]],
    transactionHash: txHash(event.block),
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

describe('findAuthorizers', () => {
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

  it('scans newest-first in windows and returns the single authorizer', async () => {
    const requests: Array<[bigint, bigint]> = []
    const events: MockEvent[] = [
      { block: 105n, identity: ROOT_A, signer: SIGNER, expiry: 1000n },
      { block: 130n, identity: ROOT_B, signer: OTHER_SIGNER, expiry: 1000n },
    ]
    server.use(JSONRPC({ ...presets.basic, eth_getLogs: mockLogs(events, requests) }))

    const authorizers = await findAuthorizers(client, {
      signer: SIGNER,
      fromBlock: 100n,
      toBlock: 149n,
      blockRange: 20n,
    })

    assert.deepEqual(authorizers, [
      {
        identity: ROOT_A,
        expiry: 1000n,
        permissions: [CreateDataSetPermission],
        origin: 'synapse',
        blockNumber: 105n,
        transactionHash: txHash(105n),
      },
    ])
    assert.deepEqual(requests, [
      [130n, 149n],
      [110n, 129n],
      [100n, 109n],
    ])
  })

  it('returns every distinct authorizer, most recent first, deduplicated by identity', async () => {
    const events: MockEvent[] = [
      { block: 101n, identity: ROOT_A, signer: SIGNER, expiry: 1000n },
      { block: 125n, identity: ROOT_B, signer: SIGNER, expiry: 2000n },
      { block: 140n, identity: ROOT_A, signer: SIGNER, expiry: 3000n },
    ]
    server.use(JSONRPC({ ...presets.basic, eth_getLogs: mockLogs(events, []) }))

    const authorizers = await findAuthorizers(client, {
      signer: SIGNER,
      fromBlock: 100n,
      toBlock: 149n,
      blockRange: 20n,
    })

    assert.deepEqual(
      authorizers.map((a) => [a.identity, a.blockNumber, a.expiry]),
      [
        [ROOT_A, 140n, 3000n],
        [ROOT_B, 125n, 2000n],
      ]
    )
  })

  it('skips revocations and authorizations with no permissions', async () => {
    const events: MockEvent[] = [
      { block: 101n, identity: ROOT_A, signer: SIGNER, expiry: 1000n },
      { block: 102n, identity: ROOT_B, signer: SIGNER, expiry: 1000n, permissions: [] },
      { block: 103n, identity: ROOT_C, signer: SIGNER, expiry: 0n },
    ]
    server.use(JSONRPC({ ...presets.basic, eth_getLogs: mockLogs(events, []) }))

    const authorizers = await findAuthorizers(client, { signer: SIGNER, fromBlock: 100n, toBlock: 110n })

    assert.deepEqual(
      authorizers.map((a) => a.identity),
      [ROOT_A]
    )
  })

  it('matches the signer case-insensitively', async () => {
    const events: MockEvent[] = [{ block: 100n, identity: ROOT_A, signer: SIGNER, expiry: 1000n }]
    server.use(JSONRPC({ ...presets.basic, eth_getLogs: mockLogs(events, []) }))

    const authorizers = await findAuthorizers(client, {
      signer: SIGNER.toUpperCase().replace('0X', '0x') as Address,
      fromBlock: 100n,
      toBlock: 100n,
    })

    assert.deepEqual(
      authorizers.map((a) => a.identity),
      [ROOT_A]
    )
  })

  it('defaults toBlock to the latest block and returns an empty list when nothing matches', async () => {
    const requests: Array<[bigint, bigint]> = []
    server.use(JSONRPC({ ...presets.basic, eth_blockNumber: numberToHex(1000n), eth_getLogs: mockLogs([], requests) }))

    const authorizers = await findAuthorizers(client, { signer: SIGNER, fromBlock: 500n })

    assert.deepEqual(authorizers, [])
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
      findAuthorizers(client, { signer: SIGNER, fromBlock: 0n, toBlock: 10n, signal: controller.signal }),
      (error: Error) => error.name === 'AbortError'
    )
  })

  it('rejects a non-positive blockRange', async () => {
    await assert.rejects(
      findAuthorizers(client, { signer: SIGNER, fromBlock: 0n, toBlock: 10n, blockRange: 0n }),
      (error: Error) => error instanceof ValidationError && error.message.includes('`blockRange` must be at least 1.')
    )
  })
})
