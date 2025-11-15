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
 *   PRIVATE_KEY=0x... node example-storage-e2e.js <file-path> [file-path2] [file-path3] ...
 */

import { ethers } from 'ethers'
import { readFile } from 'fs/promises'
import {
  ADD_PIECES_TYPEHASH,
  CREATE_DATA_SET_TYPEHASH,
  PDP_PERMISSION_NAMES,
  SIZE_CONSTANTS,
  Synapse,
  TIME_CONSTANTS,
} from '../packages/synapse-sdk/src/index.ts'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS // Optional - will use default for network

function printUsageAndExit() {
  console.error('Usage: PRIVATE_KEY=0x... node example-storage-e2e.js <file-path> [file-path2] ...')
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
    console.log('=== Synapse SDK Storage E2E Example ===\n')

    // Read all files to upload
    console.log(`Reading file${filePaths.length !== 1 ? 's' : ''}...`)
    const files = []
    let totalSize = 0

    // Currently we deal in Uint8Array blobs, so we have to read files into memory
    for (const filePath of filePaths) {
      console.log(`  Reading file: ${filePath}`)
      const fileData = await readFile(filePath)
      console.log(`    File size: ${formatBytes(fileData.length)}`)

      // Check per-file size limit
      if (fileData.length > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
        throw new Error(
          `File ${filePath} size (${formatBytes(fileData.length)}) exceeds maximum allowed size of ${formatBytes(SIZE_CONSTANTS.MAX_UPLOAD_SIZE)}`
        )
      }

      files.push({ path: filePath, data: fileData })
      totalSize += fileData.length
    }

    // Create Synapse instance
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

    // Check balances
    console.log('\n--- Checking Balances ---')
    const filBalance = await synapse.payments.walletBalance()
    const usdfcBalance = await synapse.payments.walletBalance('USDFC')
    console.log(`FIL balance: ${Number(filBalance) / 1e18} FIL`)
    console.log(`USDFC balance: ${formatUSDFC(usdfcBalance)}`)

    // Check session keys
    if (process.env.SESSION_KEY) {
      let sessionPrivateKey = process.env.SESSION_KEY
      if (!sessionPrivateKey.startsWith('0x')) {
        sessionPrivateKey = `0x${sessionPrivateKey}`
      }
      const sessionKeyWallet = new ethers.Wallet(sessionPrivateKey, synapse.getProvider())
      const sessionKey = synapse.createSessionKey(sessionKeyWallet)
      synapse.setSession(sessionKey)
      const permissions = [CREATE_DATA_SET_TYPEHASH, ADD_PIECES_TYPEHASH]
      const expiries = await sessionKey.fetchExpiries(permissions)
      const sessionKeyAddress = await sessionKeyWallet.getAddress()

      console.log('\n--- SessionKey Login ---')
      console.log(`Session Key: ${sessionKeyAddress})`)
      // Check the existing expiry of the permissions for this session key,
      // if it's not far enough in the future update them with a new login()
      const permissionsToRefresh = []
      const day = TIME_CONSTANTS.EPOCHS_PER_DAY * BigInt(TIME_CONSTANTS.EPOCH_DURATION)
      const soon = BigInt(Date.now()) / BigInt(1000) + day / BigInt(6)
      const refresh = soon + day
      for (const permission of permissions) {
        if (expiries[permission] < soon) {
          console.log(`  refreshing ${PDP_PERMISSION_NAMES[permission]}: ${expiries[permission]} to ${refresh}`)
          permissionsToRefresh.push(permission)
        }
      }
      if (permissionsToRefresh.length > 0) {
        // Use login() to reset the expiry of existing permissions to the new value
        const loginTx = await sessionKey.login(refresh, permissionsToRefresh)
        console.log(`  tx: ${loginTx.hash}`)
        const loginReceipt = await loginTx.wait()
        if (loginReceipt.status === 1) {
          console.log('✓ login successful')
        } else {
          throw new Error('Login failed')
        }
      } else {
        console.log('✓ session active')
      }
    }

    // Create storage context (optional - synapse.storage.upload() will auto-create if needed)
    // We create it explicitly here to show provider selection and data set creation callbacks
    console.log('\n--- Setting Up Storage Context ---')
    const contexts = await synapse.storage.createContexts({
      // providerIds: [123], // Optional: specify provider IDs
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
      },
    })

    for (const [index, storageContext] of contexts.entries()) {
      const providerLabel = contexts.length > 1 ? ` #${index + 1}` : ''
      if (storageContext.dataSetId === undefined) {
        console.log(`Data set not yet created`)
      } else {
        console.log(`Data set ID: ${storageContext.dataSetId}`)
      }
      const pieceCids = await storageContext.getDataSetPieces()
      console.log(`Data set contains ${pieceCids.length} piece CIDs`)
      /* Uncomment to see piece CIDs
      for (const cid of pieceCids) {
        console.log(`  - Piece CID: ${cid}`)
      }
      */

      // Get detailed provider information
      console.log(`\n--- Service Provider${providerLabel} Details ---`)
      const providerInfo = await storageContext.getProviderInfo()
      console.log(`Provider ID: ${providerInfo.id}`)
      console.log(`Provider Address: ${providerInfo.serviceProvider}`)
      console.log(`Provider Name: ${providerInfo.name}`)
      console.log(`Active: ${providerInfo.active}`)
      if (providerInfo.products.PDP?.data.serviceURL) {
        console.log(`PDP Service URL: ${providerInfo.products.PDP.data.serviceURL}`)
      }
    }

    // Run preflight checks, using total size since we care about our ability to pay
    console.log('\n--- Preflight Upload Check ---')
    const preflight = await synapse.storage.preflightUpload(totalSize)

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

    // Upload all files in parallel
    console.log('\n--- Uploading ---')
    const providerText = contexts.length > 1 ? `${contexts.length} service providers` : 'service provider'
    if (files.length > 1) {
      console.log(`Uploading files to ${providerText} in parallel...\n`)
    } else {
      console.log(`Uploading file to ${providerText}...\n`)
    }

    // Start all uploads without waiting (collect promises and not block with await)
    const uploadPromises = files.map((file, index) => {
      let pfx = ''
      if (files.length > 1) {
        pfx = `[File ${index + 1}/${files.length}] `
      }

      // Track progress in 50MiB chunks
      const PROGRESS_CHUNK_SIZE = 50 * 1024 * 1024 // 50 MiB
      let lastReportedBytes = 0
      let data = file.data
      if (contexts.length !== 1) {
        // Streaming currently unsupported for multiple providers, collect into a Uint8Array
        data = Uint8Array.from(file.data)
      }

      return synapse.storage.upload(data, {
        contexts,
        onProgress: (bytesUploaded) => {
          // Report progress every 50MiB or at completion
          if (bytesUploaded - lastReportedBytes >= PROGRESS_CHUNK_SIZE || bytesUploaded === file.data.length) {
            const percent = ((bytesUploaded / file.data.length) * 100).toFixed(1)
            console.log(
              `  ${pfx}Upload progress: ${formatBytes(bytesUploaded)} / ${formatBytes(file.data.length)} (${percent}%)`
            )
            lastReportedBytes = bytesUploaded
          }
        },
        onUploadComplete: (pieceCid) => {
          console.log(`✓ ${pfx}Upload complete! PieceCID: ${pieceCid}`)
        },
        onPiecesAdded: (transactionHash, pieces) => {
          console.log(`✓ ${pfx}Piece addition transaction: ${transactionHash}`)
          if (pieces?.length) {
            console.log(`  Pieces: ${pieces.map(({ pieceCid }) => pieceCid.toString()).join(', ')}`)
          }
        },
        onPiecesConfirmed: (dataSetId, pieces) => {
          console.log(
            `✓ ${pfx}Piece addition confirmed on data set ${dataSetId}! IDs: ${pieces
              .map(({ pieceId }) => pieceId)
              .join(', ')}`
          )
        },
      })
    })

    // Wait for all uploads to complete in parallel
    const uploadResults = await Promise.all(uploadPromises)

    console.log('\n--- Upload Summary ---')
    uploadResults.forEach((fileResult, fileIndex) => {
      console.log(`File ${fileIndex + 1}: ${files[fileIndex].path}`)
      fileResult.forEach((spResult, spIndex) => {
        console.log(`  ProviderId: ${contexts[spIndex].provider.id}`)
        if (spResult.status === 'fulfilled') {
          const uploaded = spResult.value
          console.log(`    PieceCID: ${uploaded.pieceCid}`)
          console.log(`    Size: ${formatBytes(uploaded.size)}`)
          console.log(`    Piece ID: ${uploaded.pieceId}`)
        } else {
          const reason = spResult.reason
          console.error(`    Failure reason: ${reason.message}`)
        }
      })
    })

    // Download all files back in parallel
    console.log('\n--- Downloading Files ---')
    console.log(`Downloading file${files.length !== 1 ? 's in parallel' : ''}...\n`)

    // Start all downloads without waiting (collect promises)
    const downloadPromises = uploadResults.map((fileResult, index) => {
      const pieceCid = fileResult.find((res) => res.status === 'fulfilled')?.value.pieceCid
      if (pieceCid == null) {
        console.error(`  Skipping download because no successful upload`)
        return new Promise((resolve) => resolve(null))
      } else {
        console.log(`  Downloading file ${index + 1}: ${pieceCid}`)
        // Use synapse.storage.download for SP-agnostic download (finds any provider with the piece)
        // Could also use storageContext.download() to download from the specific provider
        return synapse.storage.download(pieceCid)
      }
    })

    // Wait for all downloads to complete in parallel
    const downloadedFiles = await Promise.all(downloadPromises)

    console.log(`\n✓ Downloaded ${downloadedFiles.length} file${files.length !== 1 ? 's' : ''} successfully`)

    // Verify all files
    console.log('\n--- Verifying Data ---')
    let allMatch = true

    for (let i = 0; i < files.length; i++) {
      const downloadedData = downloadedFiles[i]
      if (downloadedData == null) {
        console.warn(`Skipped File ${i + 1} (${files[i].path})`)
        continue
      }
      const originalData = files[i].data
      const matches = Buffer.from(originalData).equals(Buffer.from(downloadedData))

      console.log(
        `File ${i + 1} (${files[i].path}): ${matches ? '✅ MATCH' : '❌ MISMATCH'} (${formatBytes(downloadedData.length)})`
      )

      if (!matches) {
        allMatch = false
      }
    }

    if (!allMatch) {
      console.error('\n❌ ERROR: One or more downloaded files do not match originals!')
      process.exit(1)
    }

    console.log('\n✅ SUCCESS: All downloaded files match originals!')

    // Check piece status for all files
    console.log('\n--- Piece Status ---')

    for (let spIndex = 0; spIndex < contexts.length; spIndex++) {
      const storageContext = contexts[spIndex]
      const providerLabel = contexts.length > 1 ? ` #${spIndex + 1}` : ''
      // Check status for the first piece (data set info is shared)
      const pieceCid = uploadResults[0][spIndex].value?.pieceCid
      if (pieceCid == null) {
        continue
      }
      const firstPieceStatus = await storageContext.pieceStatus(pieceCid)
      console.log(`Data set exists on provider: ${firstPieceStatus.exists}`)
      if (firstPieceStatus.dataSetLastProven) {
        console.log(`Data set last proven: ${firstPieceStatus.dataSetLastProven.toLocaleString()}`)
      }
      if (firstPieceStatus.dataSetNextProofDue) {
        console.log(`Data set next proof due: ${firstPieceStatus.dataSetNextProofDue.toLocaleString()}`)
      }
      if (firstPieceStatus.inChallengeWindow) {
        console.log('Currently in challenge window - proof must be submitted soon')
      } else if (firstPieceStatus.hoursUntilChallengeWindow && firstPieceStatus.hoursUntilChallengeWindow > 0) {
        console.log(`Hours until challenge window: ${firstPieceStatus.hoursUntilChallengeWindow.toFixed(1)}`)
      }

      const providerInfo = storageContext.provider
      // Show storage info
      console.log(`\n--- Storage Information${providerLabel} ---`)
      const fileText = files.length !== 1 ? 'files are' : 'file is'
      console.log(`Your ${uploadResults.length} ${fileText} now stored on the Filecoin network:`)
      console.log(`- Data set ID: ${storageContext.dataSetId}`)
      console.log(`- Service provider: ${storageContext.provider.serviceProvider}`)

      console.log('\nUploaded pieces:')
      uploadResults.forEach((fileResult, fileIndex) => {
        console.log(`\n  File ${fileIndex + 1}: ${files[fileIndex].path}`)
        if (fileResult[spIndex].status === 'fulfilled') {
          const result = fileResult[spIndex].value
          console.log(`    PieceCID: ${result.pieceCid}`)
          console.log(`    Piece ID: ${result.pieceId}`)
          console.log(`    Size: ${formatBytes(result.size)}`)
          if (providerInfo.products.PDP?.data.serviceURL) {
            console.log(
              `    Retrieval URL: ${providerInfo.products.PDP.data.serviceURL.replace(/\/$/, '')}/piece/${result.pieceCid}`
            )
          }
        }
      })
    }

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
