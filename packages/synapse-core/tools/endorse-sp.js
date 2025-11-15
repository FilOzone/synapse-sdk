import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getChain } from '../src/chains.ts'
import { signEndorsement } from '../src/utils/cert.ts'

function printUsageAndExit() {
  console.error('Usage: PRIVATE_KEY=0x... node utils/endorse-sp.js providerId...')
  process.exit(1)
}

const PRIVATE_KEY = process.env.PRIVATE_KEY
const ETH_RPC_URL = process.env.ETH_RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const EXPIRY = process.env.EXPIRY || BigInt(Math.floor(Date.now() / 1000)) + 10368000n

if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY environment variable is required')
  printUsageAndExit()
}

let CHAIN_ID = process.env.CHAIN_ID

// TODO also support providerAddress and serviceURL
const providerIds = process.argv.slice(2)
if (providerIds.length === 0) {
  console.error('ERROR: must specify at least one providerId')
  printUsageAndExit()
}

async function main() {
  if (CHAIN_ID == null) {
    console.log('fetching eth_chainId from', ETH_RPC_URL)
    const response = await fetch(ETH_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
    })
    const result = await response.json()
    CHAIN_ID = result.result
  }
  console.log('ChainId:', Number(CHAIN_ID))
  const client = createWalletClient({
    account: privateKeyToAccount(PRIVATE_KEY),
    transport: http(ETH_RPC_URL),
    chain: getChain(Number(CHAIN_ID)),
  })
  console.log('Expiry:', new Date(Number(EXPIRY) * 1000).toDateString())
  for (const providerId of providerIds) {
    const encoded = await signEndorsement(client, {
      providerId,
      notAfter: EXPIRY,
    })
    console.log('Provider:', providerId)
    console.log('Endorsement:', encoded)
  }
}

main().catch(console.error)
