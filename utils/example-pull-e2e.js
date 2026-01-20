#!/usr/bin/env node

/**
 * Example: SP-to-SP Piece Pull End-to-End Test
 *
 * This example demonstrates the SP-to-SP pull functionality:
 * 1. Upload a piece to SP1 (providerId=1) using low-level park API (no AddPieces)
 * 2. Wait for SP1 to park the piece
 * 3. Request SP2 (providerId=2) to pull the piece from SP1
 * 4. Poll until the pull completes
 * 5. Verify SP2 can serve the piece
 *
 * This tests:
 * - curio: POST /pdp/piece/pull endpoint
 * - synapse-core: warm-storage/pull module (high-level with signing)
 *
 * Required environment variables:
 * - PRIVATE_KEY: Your private key (with 0x prefix)
 * - RPC_URL: Filecoin RPC endpoint (defaults to calibration)
 *
 * Optional environment variables (for devnet):
 * - WARM_STORAGE_ADDRESS: Warm Storage service contract address
 * - MULTICALL3_ADDRESS: Multicall3 address (required for devnet)
 * - USDFC_ADDRESS: USDFC token address
 *
 * Usage:
 *   PRIVATE_KEY=0x... node example-pull-e2e.js <file-path>
 *
 * With foc-devnet:
 *   RUN_ID=$(jq -r '.run_id' ~/.foc-devnet/state/current_runid.json)
 *   PRIVATE_KEY=0x$(jq -r '.[] | select(.name=="USER_1") | .private_key' ~/.foc-devnet/keys/addresses.json) \
 *   RPC_URL=http://localhost:$(docker port foc-${RUN_ID}-lotus 1234 | cut -d: -f2)/rpc/v1 \
 *   WARM_STORAGE_ADDRESS=$(jq -r '.foc_contracts.filecoin_warm_storage_service_proxy' ~/.foc-devnet/state/latest/contract_addresses.json) \
 *   MULTICALL3_ADDRESS=$(jq -r '.contracts.multicall' ~/.foc-devnet/state/latest/contract_addresses.json) \
 *   USDFC_ADDRESS=$(jq -r '.contracts.usdfc' ~/.foc-devnet/state/latest/contract_addresses.json) \
 *   SP_REGISTRY_ADDRESS=$(jq -r '.foc_contracts.service_provider_registry_proxy' ~/.foc-devnet/state/latest/contract_addresses.json) \
 *   node utils/example-pull-e2e.js test-file.txt
 */

import fsPromises from 'fs/promises'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { devnet } from '../packages/synapse-core/src/chains.ts'
import * as SP from '../packages/synapse-core/src/sp.ts'
import { waitForPullStatus } from '../packages/synapse-core/src/warm-storage/pull.ts'
import { Synapse } from '../packages/synapse-sdk/src/index.ts'
import { SPRegistryService } from '../packages/synapse-sdk/src/sp-registry/service.ts'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS
const MULTICALL3_ADDRESS = process.env.MULTICALL3_ADDRESS
const USDFC_ADDRESS = process.env.USDFC_ADDRESS
const SP_REGISTRY_ADDRESS = process.env.SP_REGISTRY_ADDRESS

function printUsageAndExit() {
  console.error('Usage: PRIVATE_KEY=0x... node example-pull-e2e.js <file-path>')
  process.exit(1)
}

// Validate inputs
if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY environment variable is required')
  printUsageAndExit()
}

const filePaths = process.argv.slice(2)
if (filePaths.length === 0) {
  console.error('ERROR: At least one file path argument is required')
  printUsageAndExit()
}

// Helper to format bytes for display
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

// Helper to format USDFC amounts (18 decimals)
function formatUSDFC(amount) {
  const usdfc = Number(amount) / 1e18
  return `${usdfc.toFixed(6)} USDFC`
}

async function main() {
  try {
    console.log('=== SP-to-SP Pull E2E Test ===\n')
    console.log(`Processing ${filePaths.length} file(s)...`)

    // Read all files and get their stats
    const fileInfos = await Promise.all(
      filePaths.map(async (filePath) => {
        const stat = await fsPromises.stat(filePath)
        if (!stat.isFile()) {
          throw new Error(`Path is not a file: ${filePath}`)
        }
        console.log(`  ${filePath}: ${formatBytes(stat.size)}`)
        return { filePath, size: stat.size }
      })
    )

    // Create Synapse instance (still needed for provider discovery and balance checks)
    console.log('\n--- Initializing Synapse SDK ---')
    console.log(`RPC URL: ${RPC_URL}`)

    const synapseOptions = {
      multicall3Address: MULTICALL3_ADDRESS,
      privateKey: PRIVATE_KEY,
      rpcURL: RPC_URL,
      usdfcAddress: USDFC_ADDRESS,
      warmStorageAddress: WARM_STORAGE_ADDRESS,
    }

    if (WARM_STORAGE_ADDRESS) {
      console.log(`Warm Storage Address: ${WARM_STORAGE_ADDRESS}`)
    }
    if (MULTICALL3_ADDRESS) {
      console.log(`Multicall3 Address: ${MULTICALL3_ADDRESS}`)
    }

    const synapse = await Synapse.create(synapseOptions)
    console.log('Synapse instance created')

    // Create viem wallet client for signing (required by pullPieces)
    // Use devnet chain template and override with actual contract addresses from deployment
    const account = privateKeyToAccount(PRIVATE_KEY)
    const chain = {
      ...devnet,
      rpcUrls: {
        default: { http: [RPC_URL] },
      },
      contracts: {
        ...devnet.contracts,
        // Override with actual devnet deployment addresses
        storage: {
          ...devnet.contracts.storage,
          address: synapse.getWarmStorageAddress(),
        },
      },
    }
    const viemClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL),
    }).extend(publicActions)

    console.log(`Wallet address: ${account.address}`)

    // Check balances
    console.log('\n--- Checking Balances ---')
    const filBalance = await synapse.payments.walletBalance()
    const usdfcBalance = await synapse.payments.walletBalance('USDFC')
    console.log(`FIL balance: ${Number(filBalance) / 1e18} FIL`)
    console.log(`USDFC balance: ${formatUSDFC(usdfcBalance)}`)

    // Get SP1 and SP2 info
    console.log('\n--- Discovering Service Providers ---')
    console.log(`SP Registry Address: ${SP_REGISTRY_ADDRESS}`)
    const spRegistry = new SPRegistryService(synapse.getProvider(), SP_REGISTRY_ADDRESS, MULTICALL3_ADDRESS)
    const sp1Info = await spRegistry.getProvider(1)
    const sp2Info = await spRegistry.getProvider(2)

    if (!sp1Info || !sp1Info.products.PDP?.data.serviceURL) {
      throw new Error('SP1 (providerId=1) not found or missing PDP service URL')
    }
    if (!sp2Info || !sp2Info.products.PDP?.data.serviceURL) {
      throw new Error('SP2 (providerId=2) not found or missing PDP service URL')
    }

    const sp1Url = sp1Info.products.PDP.data.serviceURL.replace(/\/$/, '')
    const sp2Url = sp2Info.products.PDP.data.serviceURL.replace(/\/$/, '')

    console.log(`SP1 (providerId=1): ${sp1Info.name}`)
    console.log(`  Address: ${sp1Info.serviceProvider}`)
    console.log(`  PDP URL: ${sp1Url}`)
    console.log(`SP2 (providerId=2): ${sp2Info.name}`)
    console.log(`  Address: ${sp2Info.serviceProvider}`)
    console.log(`  PDP URL: ${sp2Url}`)

    // Upload all pieces to SP1 in parallel
    console.log('\n--- Uploading Pieces to SP1 (Park Only) ---')
    const uploadResults = await Promise.all(
      fileInfos.map(async ({ filePath, size }) => {
        const fileHandle = await fsPromises.open(filePath, 'r')
        const fileData = fileHandle.readableWebStream()

        console.log(`  Uploading ${filePath}...`)
        const result = await SP.uploadPieceStreaming({
          endpoint: sp1Url,
          data: fileData,
          size: size,
        })
        await fileHandle.close()

        const pieceCid = result.pieceCid
        console.log(`    ${filePath} -> ${pieceCid.toString().slice(0, 30)}... (${formatBytes(result.size)})`)
        return { filePath, pieceCid, size: result.size }
      })
    )

    console.log(`\nUploaded ${uploadResults.length} piece(s) to SP1`)

    // Wait for all pieces to be parked on SP1
    console.log('\n--- Waiting for SP1 to park all pieces ---')
    await Promise.all(
      uploadResults.map(async ({ pieceCid }) => {
        await SP.findPiece({
          endpoint: sp1Url,
          pieceCid: pieceCid,
        })
        console.log(`  Parked: ${pieceCid.toString().slice(0, 30)}...`)
      })
    )
    console.log('All pieces parked on SP1')

    // Get FWSS address for recordKeeper
    const fwssAddress = synapse.getWarmStorageAddress()
    console.log(`\nFWSS Address (recordKeeper): ${fwssAddress}`)

    // Initiate pull from SP2 using high-level API
    console.log('\n--- Initiating Pull to SP2 ---')
    console.log(`Target SP2 URL: ${sp2Url}`)
    console.log(`Requesting SP2 to pull ${uploadResults.length} piece(s) from SP1...`)
    console.log(`Client: ${account.address}`)
    console.log(`Payee (SP2): ${sp2Info.serviceProvider}`)
    console.log(`PieceCIDs: ${uploadResults.length} pieces`)
    for (const { pieceCid } of uploadResults) {
      console.log(`  - ${pieceCid.toString().slice(0, 40)}...`)
    }

    // Build pieces array with source URLs for each piece
    const piecesToPull = uploadResults.map(({ pieceCid }) => ({
      pieceCid: pieceCid,
      sourceUrl: `${sp1Url}/piece/${pieceCid.toString()}`,
    }))

    // Use high-level pullPieces with automatic signing
    // dataSetId omitted = create new dataset
    // recordKeeper is explicitly provided for devnet (custom chain ID not in chain registry)
    const pullResult = await waitForPullStatus(viemClient, {
      endpoint: sp2Url,
      payee: sp2Info.serviceProvider,
      recordKeeper: fwssAddress,
      pieces: piecesToPull,
      onStatus: (response) => {
        console.log(`  Pull status: ${response.status}`)
        for (const piece of response.pieces) {
          console.log(`    ${piece.pieceCid.slice(0, 20)}...: ${piece.status}`)
        }
      },
      minTimeout: 2000, // Poll every 2 seconds
    })

    console.log(`\nPull completed with status: ${pullResult.status}`)

    if (pullResult.status === 'complete') {
      console.log('\n--- Verifying SP2 has all pieces ---')

      let allMatched = true
      for (const { filePath, pieceCid } of uploadResults) {
        const sp2PieceUrl = `${sp2Url}/piece/${pieceCid.toString()}`
        console.log(`\nDownloading ${pieceCid.toString().slice(0, 30)}... from SP2`)

        const downloadResponse = await fetch(sp2PieceUrl)
        if (downloadResponse.ok) {
          const downloadedData = await downloadResponse.arrayBuffer()
          console.log(`  Downloaded ${formatBytes(downloadedData.byteLength)}`)

          // Compare with original file
          const originalData = await fsPromises.readFile(filePath)
          const matches = Buffer.from(originalData).equals(Buffer.from(downloadedData))

          if (matches) {
            console.log(`  MATCH: ${filePath}`)
          } else {
            console.error(`  MISMATCH: ${filePath}`)
            allMatched = false
          }
        } else {
          console.error(`  ERROR: Failed to download: ${downloadResponse.status}`)
          const errorText = await downloadResponse.text()
          console.error(`  Response: ${errorText}`)
          allMatched = false
        }
      }

      if (allMatched) {
        console.log(`\nSUCCESS: All ${uploadResults.length} pieces verified on SP2!`)
      } else {
        console.error('\nERROR: Some pieces did not match!')
        process.exit(1)
      }
    } else if (pullResult.status === 'failed') {
      console.error('\nERROR: Pull failed!')
      for (const piece of pullResult.pieces) {
        console.error(`  ${piece.pieceCid}: ${piece.status}`)
      }
      process.exit(1)
    }

    console.log('\n=== SP-to-SP Pull Test Complete ===')
  } catch (error) {
    console.error('\nERROR:', error.message)
    if (error.cause) {
      console.error('Caused by:', error.cause.message)
    }
    console.error(error)
    process.exit(1)
  }
}

// Run the test
main().catch(console.error)
