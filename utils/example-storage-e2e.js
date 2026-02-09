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
 * By default, configuration is loaded from the local FOC devnet info file
 * at ~/.foc-devnet/state/latest/devnet-info.json (using the first user).
 *
 * Environment variables:
 * - DETAILS_VIA_ENVVARS: Set to "true" to use env vars instead of devnet info (default: false)
 * - USE_CALIBRATION: Set to "true" to use calibration network instead of devnet (default: false)
 *
 * When DETAILS_VIA_ENVVARS=true or USE_CALIBRATION=true:
 * - PRIVATE_KEY: Your Ethereum private key (with 0x prefix)
 * - RPC_URL: Filecoin RPC endpoint (defaults to calibration)
 * - WARM_STORAGE_ADDRESS: Warm Storage service contract address (optional)
 * - MULTICALL3_ADDRESS: Multicall3 address (required for devnet)
 * - USDFC_ADDRESS: USDFC token address (optional)
 * - ENDORSEMENTS_ADDRESS: Endorsements contract address (optional)
 *
 * When DETAILS_VIA_ENVVARS=false (default):
 * - DEVNET_INFO_PATH: Path to devnet-info.json (optional, defaults to ~/.foc-devnet/state/latest/devnet-info.json)
 * - DEVNET_USER_INDEX: Index of the user to use from devnet info (optional, defaults to 0) *
 * Usage:
 *   node example-storage-e2e.js [file-path] [file-path2] [file-path3] ...
 *   DETAILS_VIA_ENVVARS=true PRIVATE_KEY=0x... node example-storage-e2e.js [file-path] ...
 *   USE_CALIBRATION=true PRIVATE_KEY=0x... node example-storage-e2e.js [file-path] ...
 *
 * If no file paths are provided, uses ~/.foc-devnet/state/latest/devnet-info.json as test file.
 */

import { readFileSync } from 'fs'
import fsPromises from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../packages/synapse-core/src/chains.ts'
import { loadDevnetInfo, toChain } from '../packages/synapse-core/src/foc-devnet-info/src/index.ts'
import { SIZE_CONSTANTS, Synapse, TIME_CONSTANTS } from '../packages/synapse-sdk/src/index.ts'
import { SessionKey } from '../packages/synapse-sdk/src/session/index.ts'

// Configuration - resolve from devnet info or environment variables
const DETAILS_VIA_ENVVARS = process.env.DETAILS_VIA_ENVVARS === 'true'
const USE_CALIBRATION = process.env.USE_CALIBRATION === 'true'

let PRIVATE_KEY
let CHAIN

if (DETAILS_VIA_ENVVARS || USE_CALIBRATION) {
  PRIVATE_KEY = process.env.PRIVATE_KEY
  const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'

  // Use calibration chain with custom RPC if provided
  CHAIN = {
    ...calibration,
    rpcUrls: {
      ...calibration.rpcUrls,
      default: { http: [RPC_URL] },
    },
  }
} else {
  // Load from FOC devnet info file
  const devnetInfoPath =
    process.env.DEVNET_INFO_PATH || join(homedir(), '.foc-devnet', 'state', 'latest', 'devnet-info.json')
  const userIndex = Number(process.env.DEVNET_USER_INDEX || '0')

  console.log(`Loading devnet info from: ${devnetInfoPath}`)
  const rawData = JSON.parse(readFileSync(devnetInfoPath, 'utf8'))
  const devnetInfo = loadDevnetInfo(rawData)
  const { info } = devnetInfo

  if (userIndex >= info.users.length) {
    console.error(`ERROR: DEVNET_USER_INDEX=${userIndex} is out of range (${info.users.length} users available)`)
    process.exit(1)
  }

  const user = info.users[userIndex]

  PRIVATE_KEY = user.private_key_hex
  CHAIN = toChain(devnetInfo)

  console.log(`Devnet run: ${info.run_id} (started: ${info.start_time})`)
  console.log(`Using user: ${user.name} (${user.evm_addr})`)
  console.log(`SPs available: ${info.pdp_sps.length}`)
}

function printUsageAndExit() {
  console.error('Usage: node example-storage-e2e.js [file-path] [file-path2] ...')
  console.error('  Default: loads config from ~/.foc-devnet/state/latest/devnet-info.json')
  console.error('  If no file paths provided, uses devnet-info.json as test file')
  console.error('  DETAILS_VIA_ENVVARS=true PRIVATE_KEY=0x... node example-storage-e2e.js [file-path]')
  console.error('  USE_CALIBRATION=true PRIVATE_KEY=0x... node example-storage-e2e.js [file-path]')
  process.exit(1)
}

// Validate inputs
if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY is required (set PRIVATE_KEY env var or use devnet info)')
  printUsageAndExit()
}

let filePaths = process.argv.slice(2)

// If no file paths provided, use the devnet info file as default test file
if (filePaths.length === 0) {
  const defaultFile = join(homedir(), '.foc-devnet', 'state', 'latest', 'devnet-info.json')
  filePaths = [defaultFile]
  console.log(`No file paths provided, using default test file: ${defaultFile}`)
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

    const mode = USE_CALIBRATION ? 'Calibration' : DETAILS_VIA_ENVVARS ? 'Environment Variables' : 'FOC DevNet'
    console.log(`Mode: ${mode}`)

    // Read all files to upload
    console.log(`Reading file${filePaths.length !== 1 ? 's' : ''}...`)
    const files = []
    let totalSize = 0

    // Currently we deal in Uint8Array blobs, so we have to read files into memory
    for (const filePath of filePaths) {
      console.log(`  Reading file: ${filePath}`)
      const stat = await fsPromises.stat(filePath)
      if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${filePath}`)
      }
      if (stat.size > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
        throw new Error(
          `File exceeds maximum size of ${formatBytes(
            SIZE_CONSTANTS.MAX_UPLOAD_SIZE
          )}: ${filePath} (${formatBytes(stat.size)})`
        )
      }
      const fh = await fsPromises.open(filePath, 'r')

      files.push({ path: filePath, handle: fh, length: stat.size })
      totalSize += stat.size
    }

    // Create Synapse instance
    console.log('\n--- Initializing Synapse SDK ---')
    console.log(`RPC URL: ${CHAIN.rpcUrls.default.http[0]}`)
    console.log(`Chain: ${CHAIN.name} (ID: ${CHAIN.id})`)

    // Create account from private key
    const account = privateKeyToAccount(PRIVATE_KEY)

    const synapseOptions = {
      chain: CHAIN,
      transport: viemHttp(),
      account,
    }

    if (CHAIN.contracts.fwss) {
      console.log(`Warm Storage Address: ${CHAIN.contracts.fwss.address}`)
    }
    if (CHAIN.contracts.multicall3) {
      console.log(`Multicall3 Address: ${CHAIN.contracts.multicall3.address}`)
    }
    if (CHAIN.contracts.usdfc) {
      console.log(`USDFC Address: ${CHAIN.contracts.usdfc.address}`)
    }
    if (CHAIN.contracts.endorsements) {
      console.log(`Endorsements Address: ${CHAIN.contracts.endorsements.address}`)
    }

    const synapse = Synapse.create(synapseOptions)
    console.log('✓ Synapse instance created')

    // Get wallet info
    const address = synapse.client.account.address
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
      const sessionAccount = privateKeyToAccount(sessionPrivateKey)
      const sessionKey = new SessionKey(synapse.client, sessionAccount)
      const permissions = ['CreateDataSet', 'AddPieces']
      const expiries = await sessionKey.fetchExpiries(permissions)
      const sessionKeyAddress = sessionAccount.address

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
          console.log(`  refreshing ${permission}: ${expiries[permission]} to ${refresh}`)
          permissionsToRefresh.push(permission)
        }
      }
      if (permissionsToRefresh.length > 0) {
        // Use login() to reset the expiry of existing permissions to the new value
        const loginTx = await sessionKey.login(refresh, permissionsToRefresh)
        console.log(`  tx: ${loginTx}`)
        // Note: In viem, we get transaction hash directly
        console.log('✓ login successful')
      } else {
        console.log('✓ session active')
      }
    }

    // Create storage context (optional - synapse.storage.upload() will auto-create if needed)
    // We create it explicitly here to show provider selection and data set creation callbacks.
    //
    // Currently we create a single context, but multiple can be created for multi-provider uploads.
    // Multi-provider uploads is currently an experimental feature. A single context can also be
    // created using the synapse.storage.createContext() method.
    console.log('\n--- Setting Up Storage Context ---')
    const contexts = await synapse.storage.createContexts({
      // providerId: 1, // Optional: specify provider ID
      count: 1,
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
      if (providerInfo.pdp?.serviceURL) {
        console.log(`PDP Service URL: ${providerInfo.pdp.serviceURL}`)
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
    const uploadPromises = files.map(async (file, index) => {
      let pfx = ''
      if (files.length > 1) {
        pfx = `[File ${index + 1}/${files.length}] `
      }

      // Track progress in chunks
      const PROGRESS_CHUNK_SIZE = 10 * 1024 * 1024 // 10 MiB
      let lastReportedBytes = 0
      let data
      if (contexts.length !== 1) {
        // Streaming currently unsupported for multiple providers, collect into a buffer
        data = await file.handle.readFile()
      } else {
        data = file.handle.readableWebStream()
      }

      return synapse.storage.upload(data, {
        contexts,
        callbacks: {
          onProgress: (bytesUploaded) => {
            if (bytesUploaded - lastReportedBytes >= PROGRESS_CHUNK_SIZE || bytesUploaded === file.length) {
              let progressMsg = ''
              if (file.length !== -1) {
                const percent = ((bytesUploaded / file.length) * 100).toFixed(1)
                progressMsg = `${formatBytes(bytesUploaded)} / ${formatBytes(file.length)} (${percent}%)`
              } else {
                progressMsg = `${formatBytes(bytesUploaded)}`
              }
              console.log(`  ${pfx}Upload progress: ${progressMsg}`)
              lastReportedBytes = bytesUploaded
            }
          },
          onUploadComplete: (pieceCid) => {
            console.log(`✓ ${pfx}Upload complete! PieceCID: ${pieceCid}`)
          },
          onPieceAdded: (transactionHash) => {
            console.log(`✓ ${pfx}Piece addition transaction: ${transactionHash}`)
          },
          onPieceConfirmed: (pieceIds) => {
            console.log(`✓ ${pfx}Piece addition confirmed! ID(s): ${pieceIds.join(', ')}`)
          },
        },
      })
    })

    // Wait for all uploads to complete in parallel
    const uploadResults = await Promise.all(uploadPromises)

    // Close all file handles
    await Promise.all(files.map((file) => file.handle.close()))

    console.log('\n--- Upload Summary ---')
    uploadResults.forEach((fileResult, fileIndex) => {
      console.log(`File ${fileIndex + 1}: ${files[fileIndex].path}`)
      console.log(`    PieceCID: ${fileResult.pieceCid}`)
      console.log(`    Size: ${formatBytes(fileResult.size)}`)
      console.log(`    Piece ID: ${fileResult.pieceId}`)
    })

    // Download all files back in parallel
    console.log('\n--- Downloading Files ---')
    console.log(`Downloading file${files.length !== 1 ? 's in parallel' : ''}...\n`)

    // Start all downloads without waiting (collect promises)
    const downloadPromises = uploadResults.map((fileResult, index) => {
      console.log(`  Downloading file ${index + 1}: ${fileResult.pieceCid}`)
      // Use synapse.storage.download for SP-agnostic download (finds any provider with the piece)
      // Could also use storageContext.download() to download from the specific provider
      return synapse.storage.download(fileResult.pieceCid)
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

      // This isn't pretty (or recommended), but just to demonstrate that our verified download
      // verified the data correctly, we'll do a direct comparison of the bytes
      const originalData = await fsPromises.readFile(files[i].path)
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

    for (const fileResult of uploadResults) {
      const pieceCid = fileResult.pieceCid

      for (let spIndex = 0; spIndex < contexts.length; spIndex++) {
        const storageContext = contexts[spIndex]
        const providerLabel = contexts.length > 1 ? ` #${spIndex + 1}` : ''
        // Check status for the first piece (data set info is shared)
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
          console.log(`    PieceCID: ${fileResult.pieceCid}`)
          console.log(`    Piece ID: ${fileResult.pieceId}`)
          console.log(`    Size: ${formatBytes(fileResult.size)}`)
          if (providerInfo.pdp?.serviceURL) {
            console.log(
              `    Retrieval URL: ${providerInfo.pdp.serviceURL.replace(/\/$/, '')}/piece/${fileResult.pieceCid}`
            )
          }
        })
      }
    }

    console.log('\nThe service provider(s) will periodically prove they still have your data.')
    console.log('You are being charged based on the storage size and duration.')
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.cause) {
      console.error('Caused by:', error.cause.message)
    }
    console.error(error)
    process.exit(1)
  }
}

// Run the example
main().catch(console.error)
