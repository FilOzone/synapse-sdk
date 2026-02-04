import { execSync } from 'node:child_process'
import { basename, dirname } from 'node:path'
import * as p from '@clack/prompts'
import { getChain } from '@filoz/synapse-core/chains'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from './config.ts'

function privateKeyFromConfig() {
  const keystore = config.get('keystore')
  if (!keystore) {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      p.log.error('Private key not found')
      p.outro('Please run `synapse init` to initialize the CLI')
      process.exit(1)
    }
    return privateKey
  }
  const keystoreDir = dirname(keystore)
  const keystoreName = basename(keystore)
  try {
    const extraction = execSync(
      `cast w dk -k ${keystoreDir} ${keystoreName}`
    ).toString()
    const foundAt = extraction.search(/0x[a-fA-F0-9]{64}/)
    if (foundAt === -1) {
      p.log.error('Failed to retrieve private key')
      p.outro('Please try again')
      process.exit(1)
    }
    return extraction.slice(foundAt, foundAt + 66)
  } catch (_error) {
    p.log.error(`Failed to access keystore`)
    p.outro('Please try again')
    process.exit(1)
  }
}

export function privateKeyClient(chainId: number) {
  const chain = getChain(chainId)

  const privateKey = privateKeyFromConfig()

  const account = privateKeyToAccount(privateKey as Hex)
  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  })
  return {
    client,
    chain,
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
