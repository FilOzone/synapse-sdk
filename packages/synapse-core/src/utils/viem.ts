import {
  type Chain,
  type Client,
  createClient,
  type FallbackTransport,
  type HttpTransport,
  http,
  type Transport,
  type TransportConfig,
  type WebSocketTransport,
} from 'viem'
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
  return createClient({
    chain,
    transport: transportFromTransportConfig({ transportConfig }),
  })
}

/**
 * Create a Viem public client from a transport configuration
 */
export function transportFromTransportConfig({ transportConfig }: { transportConfig?: TransportConfig }): Transport {
  let transport: HttpTransport | WebSocketTransport | FallbackTransport = http()
  if (transportConfig) {
    switch (transportConfig.type) {
      case 'http':
        // @ts-expect-error
        transport = http(transportConfig.url, transportConfig)
        break
      case 'webSocket':
        // @ts-expect-error
        transport = webSocket(transportConfig.getSocket(), transportConfig)
        break
      case 'fallback':
        // @ts-expect-error
        transport = fallback(transportConfig.transports, transportConfig)
        break
    }
  }

  return transport
}
