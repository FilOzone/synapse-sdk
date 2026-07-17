import { type Chain, type Client, createClient, custom, type Transport } from 'viem'

/**
 * Return a client suitable for read-only RPC calls.
 *
 * Viem uses a client's account as the default `from` address for `eth_call`.
 * Filecoin rejects calls from contract accounts and undeployed addresses during
 * sender pre-validation, even when the call is read-only. This adapter keeps the
 * configured chain and transport behavior while removing that account default.
 */
export function toReadClient<TChain extends Chain>(
  client: Client<Transport, TChain>
): Client<Transport, TChain, undefined> {
  if (client.account == null) {
    return client as Client<Transport, TChain, undefined>
  }

  return createClient({
    batch: client.batch,
    cacheTime: client.cacheTime,
    ccipRead: client.ccipRead,
    chain: client.chain,
    dataSuffix: client.dataSuffix,
    experimental_blockTag: client.experimental_blockTag,
    key: `${client.key}-read`,
    name: `${client.name} Read Client`,
    pollingInterval: client.pollingInterval,
    transport: custom(
      { request: client.transport.request },
      {
        key: client.transport.key,
        methods: client.transport.methods,
        name: client.transport.name,
        retryCount: client.transport.retryCount,
        retryDelay: client.transport.retryDelay,
      }
    ),
  })
}
