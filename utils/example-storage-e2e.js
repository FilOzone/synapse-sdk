#!/usr/bin/env node

/**
 * Example: End-to-End Storage Upload and Download
 *
 * This example demonstrates:
 * 1. Creating a Synapse instance with credentials
 * 2. Creating a StorageService
 * 3. Uploading a file to PDP storage
 * 4. Downloading the file back and verifying contents
 *
 * Required environment variables:
 * - PRIVATE_KEY: Your Ethereum private key (with 0x prefix)
 * - RPC_URL: Filecoin RPC endpoint (defaults to calibration)
 * - PANDORA_ADDRESS: Pandora service contract address (optional, uses default for network)
 *
 * Usage:
 *   PRIVATE_KEY=0x... node example-storage-e2e.js <file-path>
 */

import { readFile } from 'fs/promises'
import { Synapse } from '@filoz/synapse-sdk'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const PANDORA_ADDRESS = process.env.PANDORA_ADDRESS // Optional - will use default for network

// Validate inputs
if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY environment variable is required')
  console.error('Usage: PRIVATE_KEY=0x... node example-storage-e2e.js <file-path>')
  process.exit(1)
}

const filePath = process.argv[2]
if (!filePath) {
  console.error('ERROR: File path argument is required')
  console.error('Usage: PRIVATE_KEY=0x... node example-storage-e2e.js <file-path>')
  process.exit(1)
}

// Helper to format bytes for display
function formatBytes (bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Helper to format USDFC amounts (18 decimals)
function formatUSDFC (amount) {
  const usdfc = Number(amount) / 1e18
  return usdfc.toFixed(6) + ' USDFC'
}

async function main () {
  try {
    console.log('=== Synapse SDK Storage E2E Example ===\n')

    // Step 1: Read the file to upload
    console.log(`Reading file: ${filePath}`)
    const fileData = await readFile(filePath)
    console.log(`File size: ${formatBytes(fileData.length)}`)

    // Check size limit (200 MiB)
    const MAX_SIZE = 200 * 1024 * 1024
    if (fileData.length > MAX_SIZE) {
      throw new Error(`File size exceeds maximum allowed size of ${formatBytes(MAX_SIZE)}`)
    }

    // Step 2: Create Synapse instance
    console.log('\n--- Initializing Synapse SDK ---')
    console.log(`RPC URL: ${RPC_URL}`)

    const synapseOptions = {
      privateKey: PRIVATE_KEY,
      rpcURL: RPC_URL
    }

    // Add Pandora address if provided
    if (PANDORA_ADDRESS) {
      synapseOptions.pandoraAddress = PANDORA_ADDRESS
      console.log(`Pandora Address: ${PANDORA_ADDRESS}`)
    }

    const synapse = await Synapse.create(synapseOptions)
    console.log('✓ Synapse instance created')

    // Get wallet info
    const signer = synapse.getSigner()
    const address = await signer.getAddress()
    console.log(`Wallet address: ${address}`)

    // Step 3: Check balances
    console.log('\n--- Checking Balances ---')
    const filBalance = await synapse.payments.walletBalance()
    const usdfcBalance = await synapse.payments.walletBalance('USDFC')
    console.log(`FIL balance: ${Number(filBalance) / 1e18} FIL`)
    console.log(`USDFC balance: ${formatUSDFC(usdfcBalance)}`)

    // Step 4: Create storage service
    console.log('\n--- Creating Storage Service ---')
    const storageService = await synapse.createStorage({
      // providerId: 123, // Optional: specify a provider ID
      withCDN: false, // Set to true if you want CDN support
      callbacks: {
        onProviderSelected: (provider) => {
          console.log(`✓ Selected storage provider: ${provider.owner}`)
          console.log(`  PDP URL: ${provider.pdpUrl}`)
        },
        onProofSetResolved: (info) => {
          if (info.isExisting) {
            console.log(`✓ Using existing proof set: ${info.proofSetId}`)
          } else {
            console.log(`✓ Created new proof set: ${info.proofSetId}`)
          }
        },
        onProofSetCreationStarted: (txHash, statusUrl) => {
          console.log(`  Creating proof set, tx: ${txHash}`)
        },
        onProofSetCreationProgress: (progress) => {
          if (progress.transactionMined && !progress.proofSetLive) {
            console.log('  Transaction mined, waiting for proof set to be live...')
          }
        }
      }
    })

    console.log(`Storage provider: ${storageService.storageProvider}`)
    console.log(`Proof set ID: ${storageService.proofSetId}`)

    // Step 5: Run preflight checks
    console.log('\n--- Preflight Upload Check ---')
    const preflight = await storageService.preflightUpload(fileData.length)

    console.log('Estimated costs:')
    console.log(`  Per epoch (30s): ${formatUSDFC(preflight.estimatedCost.perEpoch)}`)
    console.log(`  Per day: ${formatUSDFC(preflight.estimatedCost.perDay)}`)
    console.log(`  Per month: ${formatUSDFC(preflight.estimatedCost.perMonth)}`)

    if (!preflight.allowanceCheck.sufficient) {
      console.error(`\n❌ Insufficient allowances: ${preflight.allowanceCheck.message}`)
      console.error('\nPlease ensure you have:')
      console.error('1. Sufficient USDFC balance')
      console.error('2. Approved USDFC spending for the Payments contract')
      console.error('3. Approved the Pandora service as an operator')
      process.exit(1)
    }

    console.log('✓ Sufficient allowances available')

    // Step 6: Upload the file
    console.log('\n--- Uploading File ---')
    console.log('Uploading to storage provider...')

    const uploadResult = await storageService.upload(fileData, {
      onUploadComplete: (commp) => {
        console.log(`✓ Upload complete! CommP: ${commp}`)
      },
      onRootAdded: () => {
        console.log('✓ Root added to proof set')
      }
    })

    console.log('\nUpload result:')
    console.log(`  CommP: ${uploadResult.commp}`)
    console.log(`  Size: ${formatBytes(uploadResult.size)}`)
    console.log(`  Root ID: ${uploadResult.rootId}`)

    // Step 7: Download the file back
    console.log('\n--- Downloading File ---')
    console.log(`Downloading piece: ${uploadResult.commp}`)

    const downloadedData = await storageService.download(uploadResult.commp)
    console.log(`✓ Downloaded ${formatBytes(downloadedData.length)}`)

    // Step 8: Verify the data
    console.log('\n--- Verifying Data ---')
    const filesMatch = Buffer.from(fileData).equals(Buffer.from(downloadedData))

    if (filesMatch) {
      console.log('✅ SUCCESS: Downloaded file matches original!')
    } else {
      console.error('❌ ERROR: Downloaded file does not match original!')
      process.exit(1)
    }

    // Step 9: Show storage info
    console.log('\n--- Storage Information ---')
    console.log('Your file is now stored on the Filecoin network with:')
    console.log(`- Piece CID / hash (CommP): ${uploadResult.commp}`)
    console.log(`- Proof set ID: ${storageService.proofSetId}`)
    console.log(`- Root ID: ${uploadResult.rootId}`)
    console.log(`- Storage provider: ${storageService.storageProvider}`)
    console.log('\nThe storage provider will periodically prove they still have your data.')
    console.log('You are being charged based on the storage size and duration.')
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.cause) {
      console.error('Caused by:', error.cause.message)
    }
    process.exit(1)
  }
}

// Run the example
main().catch(console.error)
