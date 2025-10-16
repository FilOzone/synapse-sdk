#!/usr/bin/env node

/**
 * Example: Check Piece Status or List Data Set Pieces
 *
 * This tool supports two modes:
 * 1. Piece Mode: Check status of a specific piece including proof timing
 * 2. Data set Mode: List all pieces in a data set with metadata
 *
 * Usage:
 *   node example-piece-status.js piece <pieceCid> [options]
 *   node example-piece-status.js dataset <dataSetId> [options]
 *
 * Piece Mode Arguments:
 *   pieceCid                    - The PieceCID to check
 *   --provider <id|address>     - Optional: Specific provider (ID or address)
 *   --dataset <id>              - Optional: Specific data set ID
 *
 * Data set Mode Arguments:
 *   dataSetId                   - The data set ID to inspect
 *   --hide-metadata             - Optional: Don't show piece metadata
 *
 * Environment variables:
 *   PRIVATE_KEY                 - Your Ethereum private key (with 0x prefix)
 *   RPC_URL                     - Filecoin RPC endpoint (defaults to calibration)
 *   WARM_STORAGE_ADDRESS        - Warm Storage service contract address (optional)
 *   LOCALE                      - Date/time locale (optional, defaults to system locale)
 *
 * Examples:
 *   # Check piece status (auto-discover provider)
 *   PRIVATE_KEY=0x... node example-piece-status.js piece bafkzci...
 *
 *   # Check piece on specific provider (by address)
 *   PRIVATE_KEY=0x... node example-piece-status.js piece bafkzci... --provider 0x123...
 *
 *   # Check piece on specific provider (by ID)
 *   PRIVATE_KEY=0x... node example-piece-status.js piece bafkzci... --provider 3
 *
 *   # List all pieces in data set 240
 *   PRIVATE_KEY=0x... node example-piece-status.js dataset 240
 *
 *   # List data set without metadata
 *   PRIVATE_KEY=0x... node example-piece-status.js dataset 240 --hide-metadata
 */

import { PDPServer, Synapse, WarmStorageService } from '../packages/synapse-sdk/src/index.ts'
import { SPRegistryService } from '../packages/synapse-sdk/src/sp-registry/index.ts'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS

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
  hour12: true,
}

// Helper to format dates
function formatDate(date) {
  if (!date) return 'N/A'
  return date.toLocaleString(userLocale, dateTimeOptions)
}

// Helper to format time differences
function formatTimeDiff(date) {
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

// Helper to determine proof status message
function getProofStatus(pieceStatus) {
  if (!pieceStatus.dataSetNextProofDue) {
    return 'Unknown (no proof schedule)'
  }
  if (pieceStatus.isProofOverdue) {
    return 'Proof overdue'
  }
  if (pieceStatus.inChallengeWindow) {
    return 'Proof needed urgently'
  }
  if (pieceStatus.hoursUntilChallengeWindow && pieceStatus.hoursUntilChallengeWindow < 24) {
    return 'Proof needed soon'
  }
  return 'All good'
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp()
    process.exit(0)
  }

  const mode = args[0]
  const target = args[1]

  if (mode !== 'piece' && mode !== 'dataset') {
    console.error(`ERROR: Invalid mode '${mode}'. Must be 'piece' or 'dataset'`)
    showHelp()
    process.exit(1)
  }

  if (!target) {
    console.error(`ERROR: Missing target for ${mode} mode`)
    showHelp()
    process.exit(1)
  }

  const options = {}
  for (let i = 2; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--provider') {
      const value = args[++i]
      // Auto-detect if it's an ID (number) or address (0x...)
      if (value.startsWith('0x')) {
        options.providerAddress = value
      } else {
        options.providerId = Number.parseInt(value, 10)
      }
    } else if (arg === '--dataset') {
      options.datasetId = Number.parseInt(args[++i], 10)
    } else if (arg === '--hide-metadata') {
      options.hideMetadata = true
    } else {
      console.error(`ERROR: Unknown option '${arg}'`)
      showHelp()
      process.exit(1)
    }
  }

  return { mode, target, options }
}

function showHelp() {
  console.log(`
Usage:
  node example-piece-status.js piece <pieceCid> [options]
  node example-piece-status.js dataset <dataSetId> [options]

Piece Mode Options:
  --provider <id|address>     Specific provider (ID number or 0x address)
  --dataset <id>              Specific dataset ID

Data set Mode Options:
  --hide-metadata             Don't show piece metadata

Examples:
  node example-piece-status.js piece bafkzci...
  node example-piece-status.js piece bafkzci... --provider 3
  node example-piece-status.js piece bafkzci... --provider 0x123...
  node example-piece-status.js dataset 240
  node example-piece-status.js dataset 240 --hide-metadata
  `)
}

// Helper to find piece on a provider using PDPServer (read-only)
async function findPieceOnProvider(pdpServer, pieceCid) {
  try {
    // Query the provider's HTTP endpoint to find the piece
    const pieceInfo = await pdpServer.findPiece(pieceCid)
    if (pieceInfo) {
      return pieceInfo // Returns piece info
    }
  } catch {
    // Piece not found on this provider
  }
  return null
}

// Piece mode: Check status of a specific piece
async function runPieceMode(synapse, pieceCid, options) {
  console.log('=== Piece Status ===')
  console.log(`Date: ${formatDate(new Date())}`)
  console.log(`PieceCID: ${pieceCid}\n`)

  const warmStorageService = await WarmStorageService.create(synapse.getProvider(), synapse.getWarmStorageAddress())
  const spRegistryAddress = warmStorageService.getServiceProviderRegistryAddress()
  const spRegistry = new SPRegistryService(synapse.getProvider(), spRegistryAddress)

  let providerInfo = null
  const dataSetId = options.datasetId || null

  // Determine provider
  if (options.providerAddress) {
    // Look up provider info by address
    const storageInfo = await synapse.storage.getStorageInfo()
    providerInfo = storageInfo.providers.find((p) => p.serviceProvider === options.providerAddress)
    if (!providerInfo) {
      throw new Error(`Provider ${options.providerAddress} not found in approved providers`)
    }
  } else if (options.providerId) {
    // Look up provider info by ID
    providerInfo = await spRegistry.getProvider(options.providerId)
    if (!providerInfo) {
      throw new Error(`Provider with ID ${options.providerId} not found`)
    }
  }

  // If we have a specific provider but no data set, try to find the data set
  if (providerInfo && !dataSetId) {
    console.log(`Searching for piece on provider ${providerInfo.serviceProvider}...`)
    if (!providerInfo.products.PDP?.data.serviceURL) {
      throw new Error('Provider does not have a PDP product with serviceURL')
    }
    const pdpServer = new PDPServer(null, providerInfo.products.PDP.data.serviceURL)
    const pieceInfo = await findPieceOnProvider(pdpServer, pieceCid)
    if (!pieceInfo) {
      console.log(`Piece not found on provider ${providerInfo.serviceProvider}`)
      return
    }
    console.log(`Found piece on provider ${providerInfo.serviceProvider}`)
    // Note: findPieces might not return dataSetId, we'll need to handle that
  }

  // If we still don't have a provider, auto-discover
  if (!providerInfo) {
    console.log('Auto-discovering provider...')
    const storageInfo = await synapse.storage.getStorageInfo()

    for (const provider of storageInfo.providers) {
      console.log(`Checking provider ${provider.serviceProvider}...`)
      if (!provider.products.PDP?.data.serviceURL) {
        continue
      }
      const pdpServer = new PDPServer(null, provider.products.PDP.data.serviceURL)
      const pieceInfo = await findPieceOnProvider(pdpServer, pieceCid)
      if (pieceInfo) {
        console.log(`Found piece on provider ${provider.serviceProvider}\n`)
        providerInfo = provider
        // Note: findPieces might not return dataSetId, we'll need to handle that
        break
      }
    }

    if (!providerInfo) {
      console.log('\nPiece not found on any approved provider')
      return
    }
  }

  console.log('Setting up storage context...')

  // Now create context with known provider (and data set if we have it)
  const storageOptions = {
    providerAddress: providerInfo.serviceProvider,
  }

  if (dataSetId) {
    storageOptions.dataSetId = dataSetId
  }

  const storageContext = await synapse.storage.createContext(storageOptions)

  // Get piece status
  console.log('Checking piece status...\n')
  const status = await storageContext.pieceStatus(pieceCid)

  if (!status.exists) {
    console.log('Piece does not exist on the selected service provider')
    return
  }

  // Display results
  console.log(`Provider: ${storageContext.serviceProvider}`)
  if (storageContext.provider.name) {
    console.log(`Provider Name: ${storageContext.provider.name}`)
  }
  if (storageContext.provider.id !== undefined) {
    console.log(`Provider ID: ${storageContext.provider.id}`)
  }
  console.log(`Data set: ${storageContext.dataSetId}`)

  if (status.pieceId !== undefined) {
    console.log(`Piece ID: ${status.pieceId}`)
  }

  if (status.retrievalUrl) {
    console.log(`Retrieval URL: ${status.retrievalUrl}`)
  }

  // Proof timing
  console.log('\nProof Status:')
  if (status.dataSetLastProven) {
    console.log(`  Last proven: ${formatDate(status.dataSetLastProven)} (${formatTimeDiff(status.dataSetLastProven)})`)
  } else {
    console.log('  Last proven: Never')
  }

  if (status.dataSetNextProofDue) {
    console.log(
      `  Next proof due: ${formatDate(status.dataSetNextProofDue)} (${formatTimeDiff(status.dataSetNextProofDue)})`
    )

    if (status.inChallengeWindow) {
      const timeRemaining = status.dataSetNextProofDue.getTime() - Date.now()
      const minutesRemaining = Math.floor(timeRemaining / (1000 * 60))
      console.log(`  Challenge window: Open (${minutesRemaining} minutes remaining)`)
    } else if (status.hoursUntilChallengeWindow !== undefined && status.hoursUntilChallengeWindow > 0) {
      console.log(`  Challenge window opens in: ${status.hoursUntilChallengeWindow.toFixed(1)} hours`)
    }
  } else {
    console.log('  Next proof due: Not scheduled')
  }

  console.log(`  Status: ${getProofStatus(status)}`)
}

// Data set mode: List all pieces in a data set
async function runDatasetMode(synapse, dataSetId, options) {
  console.log(`=== Data set ${dataSetId} ===`)
  console.log(`Date: ${formatDate(new Date())}\n`)

  const provider = synapse.getProvider()
  const warmStorageAddress = synapse.getWarmStorageAddress()
  const warmStorageService = await WarmStorageService.create(provider, warmStorageAddress)

  // Get data set info
  console.log('Fetching data set information...')
  const dataSetInfo = await warmStorageService.getDataSet(dataSetId)
  console.log('Data set found\n')

  // Get service provider info
  const spRegistryAddress = warmStorageService.getServiceProviderRegistryAddress()
  const spRegistry = new SPRegistryService(provider, spRegistryAddress)
  const providerInfo = await spRegistry.getProvider(dataSetInfo.providerId)

  if (!providerInfo || !providerInfo.products.PDP?.data.serviceURL) {
    throw new Error(`Provider ${dataSetInfo.providerId} does not have a PDP product with serviceURL`)
  }

  console.log(`Provider: ${providerInfo.name} (${providerInfo.serviceProvider}, ID: ${providerInfo.id})`)
  console.log(`PDP Service: ${providerInfo.products.PDP.data.serviceURL}`)
  console.log(`Payer: ${dataSetInfo.payer}`)
  console.log(`Payee: ${dataSetInfo.payee}`)

  // Get data set metadata
  console.log('\nData set Metadata:')
  const dataSetMetadata = await warmStorageService.getDataSetMetadata(dataSetId)
  const metadataKeys = Object.keys(dataSetMetadata)
  if (metadataKeys.length === 0) {
    console.log('  (none)')
  } else {
    for (const key of metadataKeys) {
      console.log(`  ${key}: ${dataSetMetadata[key] || '(empty)'}`)
    }
  }

  // Get all pieces from PDP server
  const pdpServer = new PDPServer(null, providerInfo.products.PDP.data.serviceURL)
  const dataSetData = await pdpServer.getDataSet(dataSetId)

  // Try to get proof timing if we own the data set
  console.log('\nFetching proof status...')
  let firstPieceStatus = null
  const walletAddress = await synapse.getSigner().getAddress()

  // Only try to get proof status if we own this data set (payer)
  if (dataSetInfo.payer.toLowerCase() === walletAddress.toLowerCase() && dataSetData.pieces.length > 0) {
    try {
      const storageContext = await synapse.storage.createContext({
        dataSetId,
        providerAddress: dataSetInfo.serviceProvider,
      })
      firstPieceStatus = await storageContext.pieceStatus(dataSetData.pieces[0].pieceCid)
    } catch (error) {
      console.log(`  (Could not fetch proof status: ${error.message})`)
    }
  } else if (dataSetInfo.payer.toLowerCase() !== walletAddress.toLowerCase()) {
    console.log('  (Proof status not available - data set not owned by this wallet)')
  }

  // Display proof timing if available
  if (firstPieceStatus) {
    console.log('\nProof Status:')
    if (firstPieceStatus.dataSetLastProven) {
      console.log(
        `  Last proven: ${formatDate(firstPieceStatus.dataSetLastProven)} (${formatTimeDiff(firstPieceStatus.dataSetLastProven)})`
      )
    } else {
      console.log('  Last proven: Never')
    }

    if (firstPieceStatus.dataSetNextProofDue) {
      console.log(
        `  Next proof due: ${formatDate(firstPieceStatus.dataSetNextProofDue)} (${formatTimeDiff(firstPieceStatus.dataSetNextProofDue)})`
      )

      if (firstPieceStatus.inChallengeWindow) {
        const timeRemaining = firstPieceStatus.dataSetNextProofDue.getTime() - Date.now()
        const minutesRemaining = Math.floor(timeRemaining / (1000 * 60))
        console.log(`  Challenge window: Open (${minutesRemaining} minutes remaining)`)
      } else if (
        firstPieceStatus.hoursUntilChallengeWindow !== undefined &&
        firstPieceStatus.hoursUntilChallengeWindow > 0
      ) {
        console.log(`  Challenge window opens in: ${firstPieceStatus.hoursUntilChallengeWindow.toFixed(1)} hours`)
      }
    } else {
      console.log('  Next proof due: Not scheduled')
    }

    console.log(`  Next challenge epoch: ${dataSetData.nextChallengeEpoch}`)
    console.log(`  Status: ${getProofStatus(firstPieceStatus)}`)
  } else if (dataSetData.pieces.length === 0) {
    console.log('\nProof Status:')
    console.log('  (no pieces to check status)')
  }

  // Display pieces
  console.log(`\nPieces (${dataSetData.pieces.length} total):\n`)

  if (dataSetData.pieces.length === 0) {
    console.log('(No pieces in this data set)')
    return
  }

  for (let i = 0; i < dataSetData.pieces.length; i++) {
    const pieceData = dataSetData.pieces[i]

    console.log(`Piece ${i + 1}:`)
    console.log(`  PieceCID: ${pieceData.pieceCid}`)
    console.log(`  Piece ID: ${pieceData.pieceId}`)

    if (!options.hideMetadata) {
      const pieceMetadata = await warmStorageService.getPieceMetadata(dataSetId, pieceData.pieceId)
      const pieceMetadataKeys = Object.keys(pieceMetadata)

      if (pieceMetadataKeys.length > 0) {
        console.log('  Metadata:')
        for (const key of pieceMetadataKeys) {
          console.log(`    ${key}: ${pieceMetadata[key] || '(empty)'}`)
        }
      }
    }

    const retrievalUrl = `${providerInfo.products.PDP.data.serviceURL.replace(/\/$/, '')}/piece/${pieceData.pieceCid}`
    console.log(`  Retrieval URL: ${retrievalUrl}`)
    console.log()
  }

  // Summary
  console.log(`${'='.repeat(70)}`)
  console.log('Summary:')
  console.log(`  Total pieces: ${dataSetData.pieces.length}`)
  console.log(`  Data set: ${dataSetId}`)
  console.log(`  Provider: ${dataSetInfo.serviceProvider}`)
  if (firstPieceStatus) {
    console.log(`  Status: ${getProofStatus(firstPieceStatus)}`)
  }
}

async function main() {
  try {
    // Parse arguments first (handles --help)
    const { mode, target, options } = parseArgs()

    // Validate environment
    if (!PRIVATE_KEY) {
      console.error('ERROR: PRIVATE_KEY environment variable is required')
      process.exit(1)
    }

    // Initialize Synapse SDK
    const synapseOptions = {
      privateKey: PRIVATE_KEY,
      rpcURL: RPC_URL,
    }

    if (WARM_STORAGE_ADDRESS) {
      synapseOptions.warmStorageAddress = WARM_STORAGE_ADDRESS
    }

    const synapse = await Synapse.create(synapseOptions)

    // Run the appropriate mode
    if (mode === 'piece') {
      await runPieceMode(synapse, target, options)
    } else if (mode === 'dataset') {
      const datasetId = Number.parseInt(target, 10)
      if (Number.isNaN(datasetId)) {
        console.error(`ERROR: Invalid data set ID '${target}'`)
        process.exit(1)
      }
      await runDatasetMode(synapse, datasetId, options)
    }
  } catch (error) {
    console.error(`\nError: ${error.message}`)
    if (error.cause) {
      console.error(`Caused by: ${error.cause.message}`)
    }
    process.exit(1)
  }
}

// Run the example
main().catch(console.error)
