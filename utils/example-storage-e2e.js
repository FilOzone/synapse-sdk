#!/usr/bin/env node

/**
 * Example: End-to-End Storage Upload and Download
 *
 * Demonstrates uploading files to Filecoin storage via the Synapse SDK and
 * downloading them back to verify the round-trip.
 *
 * Two upload paths are shown:
 *   - Single file:   upload() with streaming — handles everything automatically
 *   - Multiple files: split operations (store → pull → commit) — batches on-chain
 *     transactions for efficiency (1 tx per provider instead of N)
 *
 * Usage:
 *   PRIVATE_KEY=0x... node utils/example-storage-e2e.js <file-path> [file-path2] ...
 *   NETWORK=devnet node utils/example-storage-e2e.js <file-path> ...
 *   NETWORK=mainnet PRIVATE_KEY=0x... node utils/example-storage-e2e.js <file-path> ...
 *
 * See resolveConfig() at the bottom of this file for all environment variables.
 */

import fs from 'fs'
import fsPromises from 'fs/promises'
import { Readable } from 'stream'
import { http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration, devnet, mainnet } from '../packages/synapse-core/src/chains.ts'
import { SIZE_CONSTANTS, Synapse } from '../packages/synapse-sdk/src/index.ts'

async function main() {
  const { chain, privateKey, filePaths } = await resolveConfig()

  console.log('=== Synapse SDK Storage E2E Example ===\n')

  // Validate files and collect metadata
  console.log(`Reading file${filePaths.length !== 1 ? 's' : ''}...`)
  const files = []
  let totalSize = 0

  for (const filePath of filePaths) {
    const stat = await fsPromises.stat(filePath)
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${filePath}`)
    }
    if (stat.size > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
      throw new Error(
        `File exceeds maximum size of ${formatBytes(SIZE_CONSTANTS.MAX_UPLOAD_SIZE)}: ${filePath} (${formatBytes(stat.size)})`
      )
    }
    console.log(`  ${filePath} (${formatBytes(stat.size)})`)
    files.push({ path: filePath, length: stat.size })
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

  // Preflight checks
  console.log('\n--- Preflight Upload Check ---')
  const preflight = await synapse.storage.preflightUpload({ size: totalSize })

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

  // Upload files — single vs multi-file paths
  console.log('\n--- Uploading ---')

  // uploadResults is built by either the single-file or multi-file path
  const uploadResults = []

  if (files.length === 1) {
    // -----------------------------------------------------------------
    // Single file: upload() handles everything — provider selection,
    // data transfer, SP-to-SP replication, and on-chain commitment.
    // Uses streaming to avoid buffering the entire file in memory.
    // -----------------------------------------------------------------
    const file = files[0]
    const fileStream = Readable.toWeb(fs.createReadStream(file.path))
    console.log(`Uploading ${file.path} (${formatBytes(file.length)}) via stream...\n`)

    const PROGRESS_CHUNK_SIZE = 10 * 1024 * 1024 // 10 MiB
    let lastReportedBytes = 0

    const result = await synapse.storage.upload(fileStream, {
      callbacks: {
        onProviderSelected: (provider) => {
          console.log(`  Selected SP ${provider.id} (${provider.serviceProvider})`)
        },
        onDataSetResolved: (info) => {
          const verb = info.isExisting ? 'Using existing' : 'Creating new'
          console.log(`  ${verb} data set: ${info.dataSetId}`)
        },
        onProgress: (bytesUploaded) => {
          if (bytesUploaded - lastReportedBytes >= PROGRESS_CHUNK_SIZE || bytesUploaded === file.length) {
            const pct = file.length > 0 ? ` (${((bytesUploaded / file.length) * 100).toFixed(1)}%)` : ''
            console.log(`  Upload progress: ${formatBytes(bytesUploaded)}${pct}`)
            lastReportedBytes = bytesUploaded
          }
        },
        onStored: (providerId, pieceCid) => {
          console.log(`  Stored on SP ${providerId}: ${pieceCid}`)
        },
        onPullProgress: (providerId, pieceCid, status) => {
          console.log(`  Pulling to SP ${providerId}: ${pieceCid} (${status})`)
        },
        onCopyComplete: (providerId, pieceCid) => {
          console.log(`  Copied to SP ${providerId}: ${pieceCid}`)
        },
        onCopyFailed: (providerId, pieceCid, error) => {
          console.log(`  Copy failed on SP ${providerId}: ${pieceCid} - ${error.message}`)
        },
        onPiecesAdded: (transaction, providerId, pieces) => {
          console.log(`  Pieces committed on SP ${providerId}, tx: ${transaction}`)
          for (const { pieceCid } of pieces) {
            console.log(`    ${pieceCid}`)
          }
        },
        onPiecesConfirmed: (dataSetId, providerId, pieces) => {
          console.log(`  Data set ${dataSetId} confirmed on SP ${providerId}`)
          for (const { pieceCid, pieceId } of pieces) {
            console.log(`    ${pieceCid} -> pieceId ${pieceId}`)
          }
        },
      },
    })

    uploadResults.push({ file, result })
  } else {
    // -----------------------------------------------------------------
    // Multiple files: orchestrate store -> pull -> commit manually.
    //
    // More efficient than calling upload() per file because all pieces
    // are committed in a single on-chain transaction per provider,
    // rather than one transaction per file.
    // -----------------------------------------------------------------
    console.log(`Uploading ${files.length} files using split operations...\n`)

    // Create storage contexts — primary (endorsed) + secondaries
    const contexts = await synapse.storage.createContexts({
      callbacks: {
        onProviderSelected: (provider) => {
          console.log(`  Selected SP ${provider.id} (${provider.serviceProvider})`)
        },
        onDataSetResolved: (info) => {
          const verb = info.isExisting ? 'Using existing' : 'Creating new'
          console.log(`  ${verb} data set: ${info.dataSetId}`)
        },
      },
    })

    const [primary, ...secondaries] = contexts
    console.log(`Primary: SP ${primary.provider.id}`)
    for (const sec of secondaries) {
      console.log(`Secondary: SP ${sec.provider.id}`)
    }

    // Store all files on the primary provider in parallel using streaming
    const stored = await Promise.all(
      files.map(async (file) => {
        const fileStream = Readable.toWeb(fs.createReadStream(file.path))
        console.log(`\nStoring ${file.path} (${formatBytes(file.length)}) on SP ${primary.provider.id}...`)
        const storeResult = await primary.store(fileStream)
        console.log(`  Stored: ${storeResult.pieceCid}`)
        return { file, pieceCid: storeResult.pieceCid, size: storeResult.size }
      })
    )

    // Pull all pieces to each secondary via SP-to-SP transfer.
    // Pre-sign extraData per secondary so the same signature covers both
    // the pull (estimateGas validation) and commit (on-chain submission).
    const pieceCids = stored.map((s) => s.pieceCid)
    const pieceInputs = stored.map((s) => ({ pieceCid: s.pieceCid }))
    const successfulSecondaries = []

    for (const secondary of secondaries) {
      console.log(`\nPulling ${pieceCids.length} piece(s) to SP ${secondary.provider.id}...`)
      try {
        const extraData = await secondary.presignForCommit(pieceInputs)
        const pullResult = await secondary.pull({ pieces: pieceCids, from: primary, extraData })

        if (pullResult.status === 'complete') {
          console.log('  Pull complete')
          successfulSecondaries.push({ context: secondary, extraData })
        } else {
          const failedPieces = pullResult.pieces.filter((p) => p.status === 'failed')
          console.log(`  Pull failed for ${failedPieces.length} piece(s)`)
        }
      } catch (error) {
        console.log(`  Pull failed: ${error.message}`)
      }
    }

    // Commit all pieces on each provider in a single transaction.
    // Primary commits without extraData (signs internally); secondaries
    // reuse the extraData signed during the pull step.
    console.log(`\nCommitting ${stored.length} piece(s) on ${1 + successfulSecondaries.length} provider(s)...`)

    const primaryCommit = await primary.commit({ pieces: pieceInputs })
    console.log(`  Committed on SP ${primary.provider.id} (tx: ${primaryCommit.txHash.slice(0, 18)}...)`)

    const secondaryCommits = []
    for (const { context, extraData } of successfulSecondaries) {
      try {
        const result = await context.commit({ pieces: pieceInputs, extraData })
        console.log(`  Committed on SP ${context.provider.id} (tx: ${result.txHash.slice(0, 18)}...)`)
        secondaryCommits.push({ context, result })
      } catch (error) {
        console.log(`  Commit failed on SP ${context.provider.id}: ${error.message}`)
      }
    }

    // Build upload results (same shape as upload() returns)
    for (const { file, pieceCid, size } of stored) {
      const i = stored.findIndex((s) => s.pieceCid === pieceCid)
      const copies = [
        {
          providerId: primary.provider.id,
          dataSetId: primaryCommit.dataSetId,
          pieceId: primaryCommit.pieceIds[i],
          role: 'primary',
        },
        ...secondaryCommits.map(({ context, result }) => ({
          providerId: context.provider.id,
          dataSetId: result.dataSetId,
          pieceId: result.pieceIds[i],
          role: 'secondary',
        })),
      ]
      uploadResults.push({ file, result: { pieceCid, size, copies, failures: [] } })
    }
  }

  // Upload summary
  console.log('\n--- Upload Summary ---')
  for (const { file, result } of uploadResults) {
    console.log(`\nFile: ${file.path}`)
    console.log(`  PieceCID: ${result.pieceCid}`)
    console.log(`  Size: ${formatBytes(result.size)}`)

    for (const copy of result.copies) {
      const roleLabel = copy.role === 'primary' ? '[Primary]  ' : '[Secondary]'
      console.log(`  ${roleLabel} Provider ${copy.providerId} - pieceId: ${copy.pieceId}, dataSetId: ${copy.dataSetId}`)
    }

    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        console.log(`  Failed: provider ${failure.providerId} - ${failure.error.message}`)
      }
    }
  }

  // Download and verify
  console.log('\n--- Downloading and Verifying ---')

  let allMatch = true
  for (const { file, result } of uploadResults) {
    console.log(`\nDownloading ${result.pieceCid}...`)
    const downloadedData = await synapse.storage.download({ pieceCid: result.pieceCid })

    if (downloadedData == null) {
      console.error('  FAILED: Could not download')
      allMatch = false
      continue
    }

    const originalData = await fsPromises.readFile(file.path)
    const matches = Buffer.from(originalData).equals(Buffer.from(downloadedData))

    if (matches) {
      console.log(`  VERIFIED: ${formatBytes(downloadedData.length)} matches original`)
    } else {
      console.error('  MISMATCH: Downloaded data does not match original!')
      allMatch = false
    }
  }

  if (!allMatch) {
    console.error('\nERROR: One or more files failed verification!')
    process.exit(1)
  }

  console.log('\n=== SUCCESS: All files uploaded, replicated, and verified ===')
  console.log('The service provider(s) will periodically prove they still have your data.')
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
 *   - DEVNET: Path to devnet-info.json
 *     (default: ~/.foc-devnet/state/latest/devnet-info.json)
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

    const devnetInfoPath = process.env.DEVNET || join(homedir(), '.foc-devnet', 'state', 'latest', 'devnet-info.json')

    console.log(`Loading devnet info from: ${devnetInfoPath}`)
    const devnetInfo = JSON.parse(readFileSync(devnetInfoPath, 'utf8'))
    const { info } = devnetInfo

    const user = info.users[0]
    if (!privateKey) {
      privateKey = user.private_key_hex
    }

    const rpcUrl = RPC_URL || info.lotus.host_rpc_url

    // Use devnet as base (correct chainId: 31415926) with ABIs from calibration
    const c = calibration.contracts
    chain = {
      ...devnet,
      rpcUrls: { ...devnet.rpcUrls, default: { http: [rpcUrl] } },
      contracts: {
        ...c,
        fwss: { ...c.fwss, address: info.contracts.fwss_service_proxy_addr },
        fwssView: { ...c.fwssView, address: info.contracts.fwss_state_view_addr },
        multicall3: { ...c.multicall3, address: info.contracts.multicall3_addr },
        usdfc: { ...c.usdfc, address: info.contracts.mockusdfc_addr },
        filecoinPay: { ...c.filecoinPay, address: info.contracts.filecoin_pay_v1_addr },
        serviceProviderRegistry: {
          ...c.serviceProviderRegistry,
          address: info.contracts.service_provider_registry_proxy_addr,
        },
        endorsements: { ...c.endorsements, address: info.contracts.endorsements_addr },
        pdp: { ...c.pdp, address: info.contracts.pdp_verifier_proxy_addr },
      },
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
