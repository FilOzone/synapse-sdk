import type { SessionKey } from '@filoz/synapse-core/session-key'
import type { Account, Address, Chain, Client, Transport } from 'viem'
import type { Config } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

/**
 * Options shared by the write hooks that can sign with a session key.
 */
export interface SessionKeySignerOptions {
  /**
   * The session key to sign storage provider (EIP-712) operations with.
   * If not provided, the connected wallet signs.
   */
  sessionKey?: SessionKey<'Secp256k1'> | null
}

/**
 * Resolve the client that signs a write: the session key client when a session key is given,
 * otherwise the connector client of the connected wallet.
 *
 * @param config - The wagmi config.
 * @param options - The account, chain id and optional session key.
 * @returns The client to sign with.
 * @throws Error if the session key is for a different chain than `chainId`.
 */
export async function getSignerClient(
  config: Config,
  options: {
    account: Address | undefined
    chainId: number
    sessionKey?: SessionKey<'Secp256k1'> | null
  }
): Promise<Client<Transport, Chain, Account>> {
  if (options.sessionKey) {
    if (options.sessionKey.client.chain.id !== options.chainId) {
      throw new Error(
        `Session key is for chain ${options.sessionKey.client.chain.id}, but the connected chain is ${options.chainId}`
      )
    }
    return options.sessionKey.client
  }
  return await getConnectorClient(config, {
    account: options.account,
    chainId: options.chainId,
  })
}
