#!/usr/bin/env node

/**
 * Simple Storage Example - Minimal upload/download demonstration
 *
 * This example shows the simplest way to use Synapse SDK's storage API.
 * The SDK automatically handles provider selection and data set creation.
 *
 * Usage:
 *   PRIVATE_KEY=0x... WARM_STORAGE_ADDRESS=0x... node example-storage-simple.js
 */

import { Synapse } from '../packages/synapse-sdk/src/index.ts'

const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS // Optional - will use default for network

if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY environment variable is required')
  console.error('Usage: PRIVATE_KEY=0x... node example-storage-simple.js')
  process.exit(1)
}

async function main() {
  console.log('=== Synapse SDK Simple Storage Example ===\n')

  // Create Synapse instance
  const synapseOptions = {
    privateKey: PRIVATE_KEY,
    rpcURL: RPC_URL,
  }

  // Add Warm Storage address if provided
  if (WARM_STORAGE_ADDRESS) {
    synapseOptions.warmStorageAddress = WARM_STORAGE_ADDRESS
    console.log(`Using Warm Storage Address: ${WARM_STORAGE_ADDRESS}`)
  }

  const synapse = await Synapse.create(synapseOptions)

  console.log('Connected to:', RPC_URL)

  // The synapse.storage API auto-manages contexts for you
  // No need to explicitly create a storage context unless you need specific control
  console.log('Storage API ready. Will auto-select provider on first upload.')

  // Create test data (must be at least 65 bytes for PieceCID calculation)
  const testMessage =
    'Hello, Filecoin storage! This message is at least 65 bytes long to meet the minimum requirement for PieceCID calculation.\n'
  const testData = new TextEncoder().encode(testMessage)
  console.log(`\nUploading test data (${testData.length} bytes)...`)

  // Upload - the SDK will automatically:
  // 1. Select a provider
  // 2. Create or reuse a data set
  // 3. Upload the data
  const result = await synapse.storage.upload(testData)
  console.log('Upload complete!')
  console.log('PieceCID:', result.pieceCid)

  // Download - finds any provider with the piece
  console.log('\nDownloading...')
  const downloaded = await synapse.storage.download(result.pieceCid)

  // Verify
  const downloadedText = new TextDecoder().decode(downloaded)
  console.log('Downloaded:', downloadedText)

  if (downloadedText === testMessage) {
    console.log('\n✅ Success! Data verified.')
  } else {
    console.log('\n❌ Error: Data mismatch!')
  }
}

main().catch(console.error)
