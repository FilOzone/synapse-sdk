import { type Client, fallback, http, type RpcSchema, type Transport, type Chain as ViemChain } from 'viem'
import type { Account } from 'viem/accounts'
import type { FilecoinChain } from './chains.ts'
import { asChain, calibration, devnet, mainnet } from './chains.ts'
import { UnsupportedChainError } from './errors/chains.ts'
import type { Extended } from './types.ts'

/**
 * Ranked fallback HTTP transport for Filecoin mainnet.
 *
 * Tries the default, Ankr, and DRPC endpoints in latency order.
 */
export const mainnetTransport = fallback(
  [http(mainnet.rpcUrls.default.http[0]), http(mainnet.rpcUrls.ankr.http[0]), http(mainnet.rpcUrls.drpc.http[0])],
  { rank: false }
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
  { rank: false }
)

/**
 * Local HTTP transport for Filecoin Devnet.
 *
 * Uses the chain's default RPC; there is no public fallback set.
 */
export const devnetTransport = http(devnet.rpcUrls.default.http[0])

export namespace getTransport {
  export type ErrorType = UnsupportedChainError
}

/**
 * Get the default HTTP transport for a Filecoin chain.
 *
 * Mainnet and Calibration use fallbacks across public RPC endpoints. Devnet
 * uses the local default RPC.
 *
 * @param chain - The viem chain to resolve a transport for.
 * @returns The default transport for the chain.
 * @throws Errors {@link getTransport.ErrorType}
 */
export function getTransport(chain: ViemChain): Transport {
  if (chain.id === mainnet.id) {
    return mainnetTransport
  }

  if (chain.id === calibration.id) {
    return calibrationTransport
  }

  if (chain.id === devnet.id) {
    return devnetTransport
  }

  throw new UnsupportedChainError(chain.id)
}

/**
 * Convert a viem client to a synapse client.
 *
 * @param client - The viem client.
 * @returns The synapse client.
 */
export function asClient<
  account extends Account | undefined = Account | undefined,
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
  chain extends ViemChain | FilecoinChain = ViemChain | FilecoinChain,
  transport extends Transport = Transport,
>(client: Client<transport, chain, account, rpcSchema, extended>) {
  asChain(client.chain)
  return client as Client<transport, FilecoinChain, account, rpcSchema, extended>
}

/**
 * Turn any viem client into a read-only client and forces the default HTTP transport for JSON-RPC accounts using custom transport.
 */
export function toReadClient<
  chain extends ViemChain | FilecoinChain | undefined = undefined,
  account extends Account | undefined = Account | undefined,
  transport extends Transport = Transport,
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
>(
  client: Client<transport, chain, account, rpcSchema, extended>
): Client<transport, FilecoinChain, account, rpcSchema, extended> {
  if (client.chain != null) {
    asChain(client.chain)
  }

  const isJsonRpcAccount = client.account?.type === 'json-rpc'
  const transportType = client.transport.type

  const key = 'synapse-read-client'
  const name = 'Synapse Read Client'

  if (!isJsonRpcAccount && transportType === 'custom') {
    const transport = client.chain ? getTransport(client.chain) : http()
    const { config, request, value } = transport({
      account: client.account,
      chain: client.chain,
      pollingInterval: client.pollingInterval,
    })
    return { ...client, key, name, transport: { ...config, ...value }, request } as Client<
      transport,
      FilecoinChain,
      account,
      rpcSchema,
      extended
    >
  }

  return { ...client, key, name } as Client<transport, FilecoinChain, account, rpcSchema, extended>
}
