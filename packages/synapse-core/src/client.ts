import { type Client, fallback, http, type RpcSchema, type Transport, type Chain as ViemChain } from 'viem'
import type { Account } from 'viem/accounts'
import type { FilecoinChain } from './chains.ts'
import { asChain, calibration, mainnet } from './chains.ts'
import type { Extended } from './types.ts'

/**
 * Ranked fallback HTTP transport for Filecoin mainnet.
 *
 * Tries the default, Ankr, and DRPC endpoints in latency order.
 */
export const mainnetTransport = fallback(
  [http(mainnet.rpcUrls.default.http[0]), http(mainnet.rpcUrls.ankr.http[0]), http(mainnet.rpcUrls.drpc.http[0])],
  { rank: true }
)

/**
 * Ranked fallback HTTP transport for Filecoin Calibration.
 *
 * Tries the default, Ankr, and DRPC endpoints in latency order.
 */
export const calibrationTransport = fallback(
  [
    http(calibration.rpcUrls.default.http[0]),
    http(calibration.rpcUrls.ankr.http[0]),
    http(calibration.rpcUrls.drpc.http[0]),
  ],
  { rank: true }
)

/**
 * Get the default ranked fallback transport for a Filecoin chain.
 *
 * @param chain - The viem chain to resolve a transport for.
 * @returns The ranked fallback transport for mainnet or Calibration.
 * @throws Error if the chain is not supported.
 */
export function getTransport(chain: ViemChain): Transport {
  if (chain.id === mainnet.id) {
    return mainnetTransport
  }

  if (chain.id === calibration.id) {
    return calibrationTransport
  }

  throw new Error(`Unsupported chain: ${chain.id}`)
}

/**
 * Convert a viem client to a synapse client.
 *
 * @param client - The viem client.
 * @returns The synapse client.
 */
export function asClient<
  chain extends ViemChain | FilecoinChain = ViemChain | FilecoinChain,
  account extends Account | undefined = Account | undefined,
  transport extends Transport = Transport,
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
>(client: Client<transport, chain, account, rpcSchema, extended>) {
  asChain(client.chain)
  return client as Client<transport, FilecoinChain, account, rpcSchema, extended>
}

/**
 * Turn any viem client into a read-only client and forces the default HTTP transport for JSON-RPC accounts using custom transport.
 *
 * Viem uses a client's account as the default `from` address for `eth_call`.
 * Filecoin rejects calls from contract accounts and undeployed addresses during
 * sender pre-validation, even when the call is read-only. This adapter keeps the
 * configured chain and transport behavior while removing that account default.
 *
 */
export function toReadClient<
  chain extends ViemChain | FilecoinChain | undefined = undefined,
  account extends Account | undefined = Account | undefined,
  transport extends Transport = Transport,
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
>(
  client: Client<transport, chain, account, rpcSchema, extended>
): Client<transport, FilecoinChain, undefined, rpcSchema, extended> {
  if (client.chain != null) {
    asChain(client.chain)
  }
  if (client.account == null) {
    return client as Client<transport, FilecoinChain, undefined, rpcSchema, extended>
  }

  const { account, ...rest } = client

  const isJsonRpcAccount = account.type === 'json-rpc'
  const transportType = rest.transport.type

  const key = 'synapse-read-client'
  const name = 'Synapse Read Client'
  const noAccountClient = { ...rest, key, name } as Client<transport, FilecoinChain, undefined, rpcSchema, extended>

  if (!isJsonRpcAccount && transportType === 'custom') {
    const transport = client.chain ? getTransport(client.chain) : http()
    const { config, request, value } = transport({
      account: undefined,
      chain: client.chain,
      pollingInterval: rest.pollingInterval,
    })
    return { ...noAccountClient, transport: { ...config, ...value }, request }
  }

  return noAccountClient
}
