#!/usr/bin/env node

/**
 * Example: Check Piece Status
 *
 * This example demonstrates how to check the status of a piece stored on Filecoin,
 * including whether it exists, when it was last proven, and when the next proof is due.
 *
 * Usage:
 *   node example-piece-status.js <commp> [providerAddress[, dataSetId]]
 *
 * Arguments:
 *   commp           - Required: The CommP (piece commitment) to check
 *   providerAddress - Optional: Specific provider address to check
 *   dataSetId       - Optional: Specific data set ID to use
 *
 * Environment variables:
 *   PRIVATE_KEY     - Your Ethereum private key (with 0x prefix)
 *   RPC_URL         - Filecoin RPC endpoint (defaults to calibration)
 *   WARM_STORAGE_ADDRESS - Warm Storage service contract address (optional)
 *   LOCALE          - Date/time locale (optional, defaults to system locale)
 *
 * Examples:
 *   # Check piece on any provider
 *   PRIVATE_KEY=0x... node example-piece-status.js baga6ea4seaq...
 *
 *   # Check piece on specific provider
 *   PRIVATE_KEY=0x... node example-piece-status.js baga6ea4seaq... 0x123...
 *
 *   # Check piece with specific provider and data set
 *   PRIVATE_KEY=0x... node example-piece-status.js baga6ea4seaq... 0x123... 456
 */

import { Synapse } from '@filoz/synapse-sdk'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS // Optional

// Parse command line arguments
const args = process.argv.slice(2)
const commp = args[0]
const providerAddress = args[1]
const dataSetId = args[2] ? parseInt(args[2]) : undefined

// Validate inputs
if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY environment variable is required')
  console.error('Usage: PRIVATE_KEY=0x... node example-piece-status.js <commp> [providerAddress[, dataSetId]]')
  process.exit(1)
}

if (!commp) {
  console.error('ERROR: CommP argument is required')
  console.error('Usage: PRIVATE_KEY=0x... node example-piece-status.js <commp> [providerAddress[, dataSetId]]')
  process.exit(1)
}

// Get user's locale or fallback to en-US
const userLocale = process.env.LOCALE || Intl.DateTimeFormat().resolvedOptions().locale || 'en-US'

// Date formatting options
const dateTimeOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true
}

// Helper to format dates in user's locale
function formatDate (date) {
  if (!date) return 'N/A'
  return date.toLocaleString(userLocale, dateTimeOptions)
}

// Helper to format time differences
function formatTimeDiff (date) {
  if (!date) return 'N/A'

  const now = new Date()
  const diff = date.getTime() - now.getTime()
  const absDiff = Math.abs(diff)

  const hours = Math.floor(absDiff / (1000 * 60 * 60))
  const minutes = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60))

  let timeStr = ''
  if (hours > 0) {
    timeStr = `${hours} hour${hours !== 1 ? 's' : ''}`
    if (minutes > 0) {
      timeStr += ` ${minutes} minute${minutes !== 1 ? 's' : ''}`
    }
  } else {
    timeStr = `${minutes} minute${minutes !== 1 ? 's' : ''}`
  }

  return diff > 0 ? `in ${timeStr}` : `${timeStr} ago`
}

async function main () {
  try {
    console.log('=== Piece Status Check ===\n')
    console.log(`Date: ${formatDate(new Date())}`)
    console.log(`\nCommP: ${commp}`)
    if (providerAddress) {
      console.log(`Provider: ${providerAddress}`)
    }
    if (dataSetId !== undefined) {
      console.log(`Data Set ID: ${dataSetId}`)
    }

    // Initialize Synapse SDK
    console.log('\nInitializing Synapse SDK...')
    const synapseOptions = {
      privateKey: PRIVATE_KEY,
      rpcURL: RPC_URL
    }

    if (WARM_STORAGE_ADDRESS) {
      synapseOptions.warmStorageAddress = WARM_STORAGE_ADDRESS
    }

    const synapse = await Synapse.create(synapseOptions)
    console.log('✓ Synapse instance created')

    // Create storage service
    console.log('\nCreating storage service...')
    const storageOptions = {}

    // Add provider address if specified
    if (providerAddress) {
      storageOptions.providerAddress = providerAddress
    }

    // Add data set ID if specified
    if (dataSetId !== undefined) {
      storageOptions.dataSetId = dataSetId
    }

    // Add callbacks to show what's happening
    storageOptions.callbacks = {
      onProviderSelected: (provider) => {
        console.log(`✓ Using provider: ${provider.owner}`)
      },
      onDataSetResolved: (info) => {
        console.log(`✓ Using data set: ${info.dataSetId}`)
      }
    }

    const storage = await synapse.createStorage(storageOptions)

    // Check piece status
    console.log('\n--- Checking Piece Status ---')
    const status = await storage.pieceStatus(commp)

    // Display results
    console.log('\n📊 Piece Status Report:')
    console.log('─'.repeat(50))

    // Basic status
    console.log(`\n✅ Exists on provider: ${status.exists ? 'Yes' : 'No'}`)

    if (!status.exists) {
      console.log('\n❌ This piece does not exist on the selected service provider.')
      return
    }

    // Retrieval URL
    if (status.retrievalUrl) {
      console.log(`\n🔗 Retrieval URL: ${status.retrievalUrl}`)
    }

    // Piece ID
    if (status.pieceId !== undefined) {
      console.log(`\n🆔 Piece ID: ${status.pieceId}`)
    }

    // Proof timing
    console.log('\n⏱️  Data Set Timing (proofs cover all pieces in the set):')

    if (status.dataSetLastProven) {
      console.log(`   Data set last proven: ${formatDate(status.dataSetLastProven)} (${formatTimeDiff(status.dataSetLastProven)})`)
    } else {
      console.log('   Data set last proven: Never (data set not yet proven)')
    }

    if (status.dataSetNextProofDue) {
      console.log(`   Data set next proof due: ${formatDate(status.dataSetNextProofDue)} (${formatTimeDiff(status.dataSetNextProofDue)})`)

      // Challenge window status
      if (status.isProofOverdue) {
        console.log('\n🚨 PROOF IS OVERDUE!')
        console.log('   The service provider has missed the proof deadline and may face penalties.')
      } else if (status.inChallengeWindow) {
        // Calculate time remaining in challenge window
        const timeRemaining = status.dataSetNextProofDue.getTime() - new Date().getTime()
        const minutesRemaining = Math.floor(timeRemaining / (1000 * 60))
        console.log('\n⚠️  CURRENTLY IN CHALLENGE WINDOW!')
        console.log(`   The service provider has ${minutesRemaining} minutes to submit a proof.`)
      } else if (status.hoursUntilChallengeWindow !== undefined && status.hoursUntilChallengeWindow > 0) {
        console.log(`\n⏳ Challenge window opens in: ${status.hoursUntilChallengeWindow.toFixed(1)} hours`)
      }
    } else {
      console.log('   Data set next proof due: Not scheduled')
    }

    // Additional info
    console.log('\n📝 Storage Details:')
    console.log(`   Provider: ${storage.serviceProvider}`)
    console.log(`   Data Set: ${storage.dataSetId}`)

    // Summary
    console.log('\n' + '─'.repeat(50))
    if (status.isProofOverdue) {
      console.log('🚨 Status: PROOF OVERDUE - Penalties may apply')
    } else if (status.inChallengeWindow) {
      console.log('⚠️  Status: Proof urgently needed')
    } else if (status.hoursUntilChallengeWindow && status.hoursUntilChallengeWindow < 24) {
      console.log('⏰ Status: Proof needed soon')
    } else if (status.dataSetNextProofDue) {
      console.log('✅ Status: All good')
    } else {
      console.log('❓ Status: Unknown (no proof schedule)')
    }
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
