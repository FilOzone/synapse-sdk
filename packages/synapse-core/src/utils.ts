import { BrowserProvider, FallbackProvider, JsonRpcProvider, JsonRpcSigner, Wallet } from 'ethers'
import {
  type Account,
  type Chain,
  type Client,
  createClient,
  type FallbackTransport,
  fallback,
  type HttpTransport,
  http,
  type Transport,
  type TransportConfig,
  type WebSocketTransport,
  webSocket,
} from 'viem'

/**
 * Convert a Viem public client to an ethers.js provider
 *
 * @param client - Viem client
 */
export function clientToProvider(client: Client<Transport, Chain>) {
  const { chain, transport } = client
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  }

  if (transport.type === 'fallback') {
    const providers = (transport.transports as ReturnType<Transport>[]).map(
      ({ value }) => new JsonRpcProvider(value?.url, network)
    )
    if (providers.length === 1) return providers[0]
    return new FallbackProvider(providers)
  }

  return new JsonRpcProvider(transport.url, network)
}

/**
 * Convert a Viem wallet client to an ethers.js signer
 *
 * @param client - Viem wallet client
 */
export function walletClientToSigner(client: Client<Transport, Chain, Account>) {
  const { account, chain, transport } = client

  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  }

  if (account.type === 'json-rpc') {
    const provider = new BrowserProvider(transport, network)
    const signer = new JsonRpcSigner(provider, account.address)
    return signer
  } else if (account.type === 'local') {
    const provider = new JsonRpcProvider(transport.url, network)
    // @ts-ignore
    const signer = new Wallet(account.privateKey, provider)

    return signer
  } else {
    throw new Error('Unsupported account type')
  }
}

/**
 * Create a Viem public client from a transport configuration
 */
export function clientFromTransport({
  chain,
  transportConfig,
}: {
  chain: Chain
  transportConfig?: TransportConfig
}): Client<Transport, Chain> {
  let transport: HttpTransport | WebSocketTransport | FallbackTransport = http()
  if (transportConfig) {
    switch (transportConfig.type) {
      case 'http':
        // @ts-ignore
        transport = http(transportConfig.url, transportConfig)
        break
      case 'webSocket':
        // @ts-ignore
        transport = webSocket(transportConfig.getSocket(), transportConfig)
        break
      case 'fallback':
        // @ts-ignore
        transport = fallback(transportConfig.transports, transportConfig)
        break
    }
  }

  return createClient({
    chain,
    transport,
  })
}
