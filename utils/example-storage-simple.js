#!/usr/bin/env node

// NOTE: This example currently doesn't work because the minimum bytes size is much larger than
// the SDK currently states.
// See https://github.com/FilOzone/synapse-sdk/issues/82 for more information and progress on
// addressing this.

/**
 * Simple Storage Example - Minimal upload/download demonstration
 *
 * This example shows the simplest way to use Synapse SDK's storage API.
 * The SDK automatically handles provider selection and data set creation.
 *
 * Usage:
 *   PRIVATE_KEY=0x... WARM_STORAGE_ADDRESS=0x... node example-storage-simple.js
 */

import { Synapse } from '@filoz/synapse-sdk'

const PRIVATE_KEY = process.env.PRIVATE_KEY
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'

if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY environment variable is required')
  process.exit(1)
}

if (!WARM_STORAGE_ADDRESS) {
  console.error('ERROR: WARM_STORAGE_ADDRESS environment variable is required')
  console.error('For calibration network, use: 0xf49ba5eaCdFD5EE3744efEdf413791935FE4D4c5')
  process.exit(1)
}

async function main () {
  // Create Synapse instance
  const synapse = await Synapse.create({
    privateKey: PRIVATE_KEY,
    rpcURL: RPC_URL,
    warmStorageAddress: WARM_STORAGE_ADDRESS
  })

  console.log('Connected to:', RPC_URL)

  // The synapse.storage API auto-manages contexts for you
  // No need to explicitly create a storage context unless you need specific control
  console.log('Storage API ready. Will auto-select provider on first upload.')

  // Create test data (must be at least 65 bytes for PieceCID calculation)
  const testMessage = 'Hello, Filecoin storage! This message is at least 65 bytes long to meet the minimum requirement for PieceCID calculation.\n'
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
