#!/usr/bin/env node

/**
 * Example: End-to-End Storage Upload and Download
 *
 * Demonstrates uploading files to Filecoin storage via the Synapse SDK and
 * downloading them back to verify the round-trip.
 *
 * Usage:
 *   PRIVATE_KEY=0x... node utils/example-storage-e2e.js <file-path> [file-path2] ...
 *   NETWORK=devnet node utils/example-storage-e2e.js <file-path> ...
 *   NETWORK=mainnet PRIVATE_KEY=0x... node utils/example-storage-e2e.js <file-path> ...
 *
 * See resolveConfig() at the bottom of this file for all environment variables.
 */

import fsPromises from 'fs/promises'
import { http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration, mainnet } from '../packages/synapse-core/src/chains.ts'
import { SIZE_CONSTANTS, Synapse } from '../packages/synapse-sdk/src/index.ts'

async function main() {
  const { chain, privateKey, filePaths } = await resolveConfig()

  console.log('=== Synapse SDK Storage E2E Example ===\n')

  // Read files into memory
  console.log(`Reading file${filePaths.length !== 1 ? 's' : ''}...`)
  const files = []
  let totalSize = 0

  for (const filePath of filePaths) {
    console.log(`  Reading file: ${filePath}`)
    const stat = await fsPromises.stat(filePath)
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`)
    }
    if (stat.size > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
      throw new Error(
        `File exceeds maximum size of ${formatBytes(SIZE_CONSTANTS.MAX_UPLOAD_SIZE)}: ${filePath} (${formatBytes(stat.size)})`
      )
    }
    files.push({ path: filePath, handle: await fsPromises.open(filePath, 'r'), length: stat.size })
    totalSize += stat.size
  }

  // Create Synapse instance
  console.log('\n--- Initializing Synapse SDK ---')
  console.log(`Network: ${chain.name}`)
  console.log(`RPC URL: ${chain.rpcUrls.default.http[0]}`)

  const account = privateKeyToAccount(privateKey)
  console.log(`Wallet address: ${account.address}`)

  const synapse = Synapse.create({
    chain,
    transport: viemHttp(),
    account,
  })

  console.log('Synapse instance created')

  // Check balances
  console.log('\n--- Checking Balances ---')
  const filBalance = await synapse.payments.walletBalance()
  const usdfcBalance = await synapse.payments.walletBalance('USDFC')
  console.log(`FIL balance: ${Number(filBalance) / 1e18} FIL`)
  console.log(`USDFC balance: ${formatUSDFC(usdfcBalance)}`)

  // Create storage context (auto-selects provider and data set)
  console.log('\n--- Setting Up Storage Context ---')
  const contexts = await synapse.storage.createContexts({
    count: 1,
    withCDN: false,
    callbacks: {
      onProviderSelected: (provider) => {
        console.log(`Selected service provider: ${provider.serviceProvider}`)
      },
      onDataSetResolved: (info) => {
        if (info.isExisting) {
          console.log(`Using existing data set: ${info.dataSetId}`)
        } else {
          console.log(`Created new data set: ${info.dataSetId}`)
        }
      },
    },
  })

  for (const [index, storageContext] of contexts.entries()) {
    const providerLabel = contexts.length > 1 ? ` #${index + 1}` : ''
    if (storageContext.dataSetId === undefined) {
      console.log('Data set not yet created')
    } else {
      console.log(`Data set ID: ${storageContext.dataSetId}`)
    }
    const pieceCids = await storageContext.getDataSetPieces()
    console.log(`Data set contains ${pieceCids.length} piece CIDs`)

    console.log(`\n--- Service Provider${providerLabel} Details ---`)
    const providerInfo = await storageContext.getProviderInfo()
    console.log(`Provider ID: ${providerInfo.id}`)
    console.log(`Provider Address: ${providerInfo.serviceProvider}`)
    console.log(`Provider Name: ${providerInfo.name}`)
    console.log(`Active: ${providerInfo.isActive}`)
    if (providerInfo.pdp?.serviceURL) {
      console.log(`PDP Service URL: ${providerInfo.pdp.serviceURL}`)
    }
  }

  // Preflight checks
  console.log('\n--- Preflight Upload Check ---')
  const preflight = await synapse.storage.preflightUpload(totalSize)

  console.log('Estimated costs:')
  console.log(`  Per epoch (30s): ${formatUSDFC(preflight.estimatedCost.perEpoch)}`)
  console.log(`  Per day: ${formatUSDFC(preflight.estimatedCost.perDay)}`)
  console.log(`  Per month: ${formatUSDFC(preflight.estimatedCost.perMonth)}`)

  if (!preflight.allowanceCheck.sufficient) {
    console.error(`\nInsufficient allowances: ${preflight.allowanceCheck.message}`)
    console.error('\nPlease ensure you have:')
    console.error('1. Sufficient USDFC balance')
    console.error('2. Approved USDFC spending for the Payments contract')
    console.error('3. Approved the Warm Storage service as an operator')
    process.exit(1)
  }

  console.log('Sufficient allowances available')

  // Upload
  console.log('\n--- Uploading ---')
  const providerText = contexts.length > 1 ? `${contexts.length} service providers` : 'service provider'
  if (files.length > 1) {
    console.log(`Uploading files to ${providerText} in parallel...\n`)
  } else {
    console.log(`Uploading file to ${providerText}...\n`)
  }

  const uploadPromises = files.map(async (file, index) => {
    let pfx = ''
    if (files.length > 1) {
      pfx = `[File ${index + 1}/${files.length}] `
    }

    const PROGRESS_CHUNK_SIZE = 10 * 1024 * 1024 // 10 MiB
    let lastReportedBytes = 0
    const data = contexts.length !== 1 ? await file.handle.readFile() : file.handle.readableWebStream()

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
          console.log(`${pfx}Upload complete! PieceCID: ${pieceCid}`)
        },
        onPieceAdded: (transactionHash) => {
          console.log(`${pfx}Piece addition transaction: ${transactionHash}`)
        },
        onPieceConfirmed: (pieceIds) => {
          console.log(`${pfx}Piece addition confirmed! ID(s): ${pieceIds.join(', ')}`)
        },
      },
    })
  })

  const uploadResults = await Promise.all(uploadPromises)
  await Promise.all(files.map((file) => file.handle.close()))

  console.log('\n--- Upload Summary ---')
  uploadResults.forEach((fileResult, fileIndex) => {
    console.log(`File ${fileIndex + 1}: ${files[fileIndex].path}`)
    console.log(`    PieceCID: ${fileResult.pieceCid}`)
    console.log(`    Size: ${formatBytes(fileResult.size)}`)
    console.log(`    Piece ID: ${fileResult.pieceId}`)
  })

  // Download and verify
  console.log('\n--- Downloading Files ---')
  console.log(`Downloading file${files.length !== 1 ? 's in parallel' : ''}...\n`)

  const downloadPromises = uploadResults.map((fileResult, index) => {
    console.log(`  Downloading file ${index + 1}: ${fileResult.pieceCid}`)
    return synapse.storage.download(fileResult.pieceCid)
  })

  const downloadedFiles = await Promise.all(downloadPromises)
  console.log(`\nDownloaded ${downloadedFiles.length} file${files.length !== 1 ? 's' : ''} successfully`)

  console.log('\n--- Verifying Data ---')
  let allMatch = true

  for (let i = 0; i < files.length; i++) {
    const downloadedData = downloadedFiles[i]
    if (downloadedData == null) {
      console.warn(`Skipped File ${i + 1} (${files[i].path})`)
      continue
    }

    const originalData = await fsPromises.readFile(files[i].path)
    const matches = Buffer.from(originalData).equals(Buffer.from(downloadedData))

    console.log(
      `File ${i + 1} (${files[i].path}): ${matches ? 'MATCH' : 'MISMATCH'} (${formatBytes(downloadedData.length)})`
    )

    if (!matches) {
      allMatch = false
    }
  }

  if (!allMatch) {
    console.error('\nERROR: One or more downloaded files do not match originals!')
    process.exit(1)
  }

  console.log('\nSUCCESS: All downloaded files match originals!')

  // Piece status and storage info
  console.log('\n--- Piece Status ---')

  for (const fileResult of uploadResults) {
    const pieceCid = fileResult.pieceCid

    for (let spIndex = 0; spIndex < contexts.length; spIndex++) {
      const storageContext = contexts[spIndex]
      const providerLabel = contexts.length > 1 ? ` #${spIndex + 1}` : ''
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
}

// ────────────────────────────────────────────────────────────
// Configuration and helpers
// ────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

function formatUSDFC(amount) {
  const usdfc = Number(amount) / 1e18
  return `${usdfc.toFixed(6)} USDFC`
}

/**
 * Resolve chain, private key, and file paths from environment and CLI args.
 *
 * Environment variables:
 * - PRIVATE_KEY: Ethereum private key (0x-prefixed). Required for calibnet/mainnet.
 * - NETWORK: "mainnet" | "calibnet" | "devnet" (default: "calibnet")
 * - RPC_URL: Override the default RPC endpoint for any network.
 *
 * Devnet mode (NETWORK=devnet):
 *   Loads chain config from foc-devnet's devnet-info.json. PRIVATE_KEY is
 *   optional — defaults to the first devnet user.
 *   - DEVNET_INFO_PATH: Path to devnet-info.json
 *     (default: ~/.foc-devnet/state/latest/devnet-info.json)
 *   - DEVNET_USER_INDEX: Which user from devnet info (default: 0)
 *
 * Calibnet/mainnet address overrides (optional):
 *   - WARM_STORAGE_ADDRESS, MULTICALL3_ADDRESS, USDFC_ADDRESS, ENDORSEMENTS_ADDRESS
 */
async function resolveConfig() {
  const filePaths = process.argv.slice(2)
  if (filePaths.length === 0) {
    console.error('Usage: PRIVATE_KEY=0x... node utils/example-storage-e2e.js <file-path> [file-path2] ...')
    console.error('       NETWORK=devnet node utils/example-storage-e2e.js <file-path> ...')
    process.exit(1)
  }

  const NETWORK = process.env.NETWORK || 'calibnet'
  const RPC_URL = process.env.RPC_URL
  let privateKey = process.env.PRIVATE_KEY
  let chain

  if (NETWORK === 'devnet') {
    const { readFileSync } = await import('fs')
    const { homedir } = await import('os')
    const { join } = await import('path')
    const { validateDevnetInfo, toChain } = await import('../packages/synapse-core/src/devnet/index.ts')

    const devnetInfoPath =
      process.env.DEVNET_INFO_PATH || join(homedir(), '.foc-devnet', 'state', 'latest', 'devnet-info.json')
    const userIndex = Number(process.env.DEVNET_USER_INDEX || '0')

    console.log(`Loading devnet info from: ${devnetInfoPath}`)
    const rawData = JSON.parse(readFileSync(devnetInfoPath, 'utf8'))
    const devnetInfo = validateDevnetInfo(rawData)
    const { info } = devnetInfo

    if (userIndex >= info.users.length) {
      console.error(`ERROR: DEVNET_USER_INDEX=${userIndex} out of range (${info.users.length} users available)`)
      process.exit(1)
    }

    const user = info.users[userIndex]
    if (!privateKey) {
      privateKey = user.private_key_hex
    }

    chain = toChain(devnetInfo)
    if (RPC_URL) {
      chain = { ...chain, rpcUrls: { ...chain.rpcUrls, default: { http: [RPC_URL] } } }
    }

    console.log(`Devnet run: ${info.run_id}`)
    console.log(`Using user: ${user.name} (${user.evm_addr})`)
    console.log(`SPs available: ${info.pdp_sps.length}`)
  } else {
    const baseChain = NETWORK === 'mainnet' ? mainnet : calibration

    chain = RPC_URL ? { ...baseChain, rpcUrls: { ...baseChain.rpcUrls, default: { http: [RPC_URL] } } } : baseChain

    const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS
    const MULTICALL3_ADDRESS = process.env.MULTICALL3_ADDRESS
    const USDFC_ADDRESS = process.env.USDFC_ADDRESS
    const ENDORSEMENTS_ADDRESS = process.env.ENDORSEMENTS_ADDRESS
    if (WARM_STORAGE_ADDRESS || MULTICALL3_ADDRESS || USDFC_ADDRESS || ENDORSEMENTS_ADDRESS) {
      chain = {
        ...chain,
        contracts: {
          ...chain.contracts,
          ...(WARM_STORAGE_ADDRESS ? { fwss: { ...chain.contracts.fwss, address: WARM_STORAGE_ADDRESS } } : {}),
          ...(MULTICALL3_ADDRESS ? { multicall3: { address: MULTICALL3_ADDRESS, blockCreated: 0 } } : {}),
          ...(USDFC_ADDRESS ? { usdfc: { ...chain.contracts.usdfc, address: USDFC_ADDRESS } } : {}),
          ...(ENDORSEMENTS_ADDRESS
            ? { endorsements: { ...chain.contracts.endorsements, address: ENDORSEMENTS_ADDRESS } }
            : {}),
        },
      }
    }
  }

  if (!privateKey) {
    console.error('ERROR: PRIVATE_KEY environment variable is required')
    console.error('Usage: PRIVATE_KEY=0x... node utils/example-storage-e2e.js <file-path> [file-path2] ...')
    console.error('       NETWORK=devnet node utils/example-storage-e2e.js <file-path> ...')
    process.exit(1)
  }

  return { chain, privateKey, filePaths }
}

// ────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('\nError:', error.message)
  if (error.cause) {
    console.error('Caused by:', error.cause.message)
  }
  console.error(error)
  process.exit(1)
})
