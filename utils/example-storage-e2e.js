#!/usr/bin/env node

/**
 * Example: End-to-End Storage Upload and Download
 *
 * This example demonstrates:
 * 1. Creating a Synapse instance with credentials
 * 2. Using the synapse.storage API for uploads and downloads
 * 3. Uploading a file to PDP storage with callbacks
 * 4. Downloading the file back and verifying contents
 *
 * Required environment variables:
 * - PRIVATE_KEY: Your Ethereum private key (with 0x prefix)
 * - RPC_URL: Filecoin RPC endpoint (defaults to calibration)
 * - WARM_STORAGE_ADDRESS: Warm Storage service contract address (optional, uses default for network)
 *
 * Usage:
 *   PRIVATE_KEY=0x... node example-storage-e2e.js <file-path>
 */

import { Synapse } from '@filoz/synapse-sdk'
import { readFile } from 'fs/promises'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS // Optional - will use default for network

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
      rpcURL: RPC_URL,
    }

    // Add Warm Storage address if provided
    if (WARM_STORAGE_ADDRESS) {
      synapseOptions.warmStorageAddress = WARM_STORAGE_ADDRESS
      console.log(`Warm Storage Address: ${WARM_STORAGE_ADDRESS}`)
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

    // Step 4: Create storage context (optional - synapse.storage.upload() will auto-create if needed)
    // We create it explicitly here to show provider selection and data set creation callbacks
    console.log('\n--- Setting Up Storage Context ---')
    const storageContext = await synapse.storage.createContext({
      // providerId: 123, // Optional: specify a provider ID
      withCDN: false, // Set to true if you want CDN support
      callbacks: {
        onProviderSelected: (provider) => {
          console.log(`✓ Selected service provider: ${provider.serviceProvider}`)
        },
        onDataSetResolved: (info) => {
          if (info.isExisting) {
            console.log(`✓ Using existing data set: ${info.dataSetId}`)
          } else {
            console.log(`✓ Created new data set: ${info.dataSetId}`)
          }
        },
        onDataSetCreationStarted: (transaction) => {
          console.log(`  Creating data set, tx: ${transaction.hash}`)
        },
        onDataSetCreationProgress: (progress) => {
          if (progress.transactionMined && !progress.dataSetLive) {
            console.log('  Transaction mined, waiting for data set to be live...')
          }
        },
      },
    })

    console.log(`Data set ID: ${storageContext.dataSetId}`)
    const pieceCids = await storageContext.getDataSetPieces()
    console.log(`Data set contains ${pieceCids.length} piece CIDs`)
    /* Uncomment to see piece CIDs
    for (const cid of pieceCids) {
      console.log(`  - Piece CID: ${cid}`)
    }
    */

    // Get detailed provider information
    console.log('\n--- Service Provider Details ---')
    const providerInfo = await storageContext.getProviderInfo()
    console.log(`Service Provider: ${providerInfo.serviceProvider}`)
    console.log(`Service URL: ${providerInfo.serviceURL}`)
    console.log(`Peer ID: ${providerInfo.peerId}`)
    console.log(`Registered: ${new Date(providerInfo.registeredAt * 1000).toLocaleString()}`)
    console.log(`Approved: ${new Date(providerInfo.approvedAt * 1000).toLocaleString()}`)

    // Step 5: Run preflight checks
    console.log('\n--- Preflight Upload Check ---')
    const preflight = await storageContext.preflightUpload(fileData.length)

    console.log('Estimated costs:')
    console.log(`  Per epoch (30s): ${formatUSDFC(preflight.estimatedCost.perEpoch)}`)
    console.log(`  Per day: ${formatUSDFC(preflight.estimatedCost.perDay)}`)
    console.log(`  Per month: ${formatUSDFC(preflight.estimatedCost.perMonth)}`)

    if (!preflight.allowanceCheck.sufficient) {
      console.error(`\n❌ Insufficient allowances: ${preflight.allowanceCheck.message}`)
      console.error('\nPlease ensure you have:')
      console.error('1. Sufficient USDFC balance')
      console.error('2. Approved USDFC spending for the Payments contract')
      console.error('3. Approved the Warm Storage service as an operator')
      process.exit(1)
    }

    console.log('✓ Sufficient allowances available')

    // Step 6: Upload the file
    console.log('\n--- Uploading File ---')
    console.log('Uploading to service provider...')

    // Note: With updated Curio servers, you'll get enhanced transaction tracking
    // The callbacks below demonstrate both old and new server compatibility

    // Using the context we created earlier (could also use synapse.storage.upload directly)
    const uploadResult = await storageContext.upload(fileData, {
      onUploadComplete: (pieceCid) => {
        console.log(`✓ Upload complete! PieceCID: ${pieceCid}`)
      },
      onPieceAdded: (transaction) => {
        if (transaction) {
          // New enhanced callback with transaction info
          console.log(`✓ Piece addition transaction submitted: ${transaction.hash}`)
          console.log('  Waiting for confirmation...')
        } else {
          // Fallback for old servers
          console.log('✓ Piece added to data set')
        }
      },
      onPieceConfirmed: (pieceIds) => {
        // New callback - only called with updated servers
        console.log('✓ Piece addition confirmed on-chain!')
        console.log(`  Assigned piece IDs: ${pieceIds.join(', ')}`)
      },
    })

    console.log('\nUpload result:')
    console.log(`  PieceCID: ${uploadResult.pieceCid}`)
    console.log(`  Size: ${formatBytes(uploadResult.size)}`)
    console.log(`  Piece ID: ${uploadResult.pieceId}`)

    // Step 7: Download the file back
    console.log('\n--- Downloading File ---')
    console.log(`Downloading piece: ${uploadResult.pieceCid}`)

    // Use synapse.storage.download for SP-agnostic download (finds any provider with the piece)
    // Could also use storageContext.download() to download from the specific provider
    const downloadedData = await synapse.storage.download(uploadResult.pieceCid)
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

    // Step 9: Check piece status
    console.log('\n--- Piece Status ---')
    const pieceStatus = await storageContext.pieceStatus(uploadResult.pieceCid)
    console.log(`Piece exists on provider: ${pieceStatus.exists}`)
    if (pieceStatus.dataSetLastProven) {
      console.log(`Data set last proven: ${pieceStatus.dataSetLastProven.toLocaleString()}`)
    }
    if (pieceStatus.dataSetNextProofDue) {
      console.log(`Data set next proof due: ${pieceStatus.dataSetNextProofDue.toLocaleString()}`)
    }
    if (pieceStatus.inChallengeWindow) {
      console.log('⚠️  Currently in challenge window - proof must be submitted soon!')
    } else if (pieceStatus.hoursUntilChallengeWindow && pieceStatus.hoursUntilChallengeWindow > 0) {
      console.log(`Hours until challenge window: ${pieceStatus.hoursUntilChallengeWindow.toFixed(1)}`)
    }

    // Step 10: Show storage info
    console.log('\n--- Storage Information ---')
    console.log('Your file is now stored on the Filecoin network with:')
    console.log(`- Piece CID / hash (PieceCID): ${uploadResult.pieceCid}`)
    console.log(`- Data set ID: ${storageContext.dataSetId}`)
    console.log(`- Piece ID: ${uploadResult.pieceId}`)
    console.log(`- Service provider: ${storageContext.serviceProvider}`)
    console.log('\nThe service provider will periodically prove they still have your data.')
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
