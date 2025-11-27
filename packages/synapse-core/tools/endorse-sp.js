import EthModule from '@ledgerhq/hw-app-eth'
import TransportNodeHidModule from '@ledgerhq/hw-transport-node-hid'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount, toAccount } from 'viem/accounts'

const TransportNodeHid = TransportNodeHidModule.default || TransportNodeHidModule
const Eth = EthModule.default || EthModule

import { getChain } from '../src/chains.ts'
import { signEndorsement } from '../src/utils/cert.ts'

function printUsageAndExit() {
  console.error('Usage: PRIVATE_KEY=0x... node tools/endorse-sp.js providerId...')
  console.error('   or: USE_LEDGER=true node tools/endorse-sp.js providerId...')
  process.exit(1)
}

const PRIVATE_KEY = process.env.PRIVATE_KEY
const USE_LEDGER = process.env.USE_LEDGER === 'true'
const LEDGER_PATH = process.env.LEDGER_PATH || "m/44'/60'/0'/0/0"
const ETH_RPC_URL = process.env.ETH_RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const EXPIRY = process.env.EXPIRY || BigInt(Math.floor(Date.now() / 1000)) + 10368000n

if (!PRIVATE_KEY && !USE_LEDGER) {
  console.error('ERROR: Either PRIVATE_KEY or USE_LEDGER=true is required')
  printUsageAndExit()
}

let CHAIN_ID = process.env.CHAIN_ID

// TODO also support providerAddress and serviceURL
const providerIds = process.argv.slice(2)
if (providerIds.length === 0) {
  console.error('ERROR: must specify at least one providerId')
  printUsageAndExit()
}

async function createLedgerAccount() {
  const transport = await TransportNodeHid.open('')
  const eth = new Eth(transport)

  const { address } = await eth.getAddress(LEDGER_PATH)

  const account = toAccount({
    address,
    async signMessage({ message }) {
      const messageHex = typeof message === 'string' ? Buffer.from(message).toString('hex') : message.slice(2)
      const result = await eth.signPersonalMessage(LEDGER_PATH, messageHex)
      return `0x${result.r}${result.s}${(result.v - 27).toString(16).padStart(2, '0')}`
    },
    async signTransaction(_transaction) {
      throw new Error('signTransaction not needed for this script')
    },
    async signTypedData(typedData) {
      const result = await eth.signEIP712Message(LEDGER_PATH, typedData)
      return `0x${result.r}${result.s}${(result.v - 27).toString(16).padStart(2, '0')}`
    },
  })

  return { account, close: () => transport.close() }
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

  let account
  let closeLedgerTransport = null
  if (USE_LEDGER) {
    console.log('🔐 Using Ledger hardware wallet')
    console.log('📍 Path:', LEDGER_PATH, '(Ethereum standard)')
    console.log('⚠️  Connect Ledger, unlock, and open the Ethereum app')
    console.log('⚠️  Enable "Blind signing" in Ethereum app settings')
    const ledgerResult = await createLedgerAccount()
    account = ledgerResult.account
    closeLedgerTransport = ledgerResult.close
    console.log('✅ Connected, address:', account.address)
  } else {
    account = privateKeyToAccount(PRIVATE_KEY)
  }

  try {
    const client = createWalletClient({
      account,
      transport: http(ETH_RPC_URL),
      chain: getChain(Number(CHAIN_ID)),
    })

    console.log('Expiry:', new Date(Number(EXPIRY) * 1000).toDateString())

    for (const providerId of providerIds) {
      if (USE_LEDGER) console.log('\n⏳ Confirm on Ledger for provider:', providerId)
      const encoded = await signEndorsement(client, {
        providerId: BigInt(providerId),
        notAfter: EXPIRY,
      })
      console.log('Provider:', providerId)
      console.log('Endorsement:', encoded)
    }
  } finally {
    if (closeLedgerTransport != null) {
      await closeLedgerTransport()
    }
  }
}

main().catch(console.error)
