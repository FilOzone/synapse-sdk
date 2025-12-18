import * as p from '@clack/prompts'
import { getChain } from '@filoz/synapse-core/chains'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from './config.ts'

export function privateKeyClient(chainId: number) {
  const chain = getChain(chainId)
  const privateKey = config.get('privateKey')
  if (!privateKey) {
    p.log.error('Private key not found')
    p.outro('Please run `synapse init` to initialize the CLI')
    process.exit(1)
  }
  const account = privateKeyToAccount(privateKey as Hex)
  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  })
  return {
    client,
    privateKey: privateKey as Hex,
    rpcURL: chain.rpcUrls.default.http[0],
  }
}

export function publicClient(chainId: number) {
  const chain = getChain(chainId)
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  return publicClient
}
