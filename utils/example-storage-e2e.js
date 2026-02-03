#!/usr/bin/env node

/**
 * Example: End-to-End Storage Upload and Download
 *
 * This example demonstrates:
 * 1. Creating a Synapse instance with credentials
 * 2. Single-file upload using synapse.storage.upload()
 * 3. Multi-file upload using split operations (store → pull → commit)
 * 4. Downloading and verifying contents
 *
 * For a single file, upload() handles everything: provider selection, data
 * transfer, SP-to-SP replication, and on-chain commitment.
 *
 * For multiple files, the split operations give you control over batching:
 * store each file on the primary, pull all pieces to secondaries in one
 * request, then commit all pieces per provider in a single transaction.
 * This is more efficient than calling upload() per file because it reduces
 * on-chain transactions from N×providers to just 1×providers.
 *
 * Required environment variables:
 * - PRIVATE_KEY: Your Ethereum private key (with 0x prefix)
 *
 * Optional environment variables:
 * - RPC_URL: Filecoin RPC endpoint (defaults to calibration)
 * - NETWORK: Network to use (mainnet | calibnet | devnet, default: calibnet)
 * - COPY_COUNT: Number of copies to store (default: 2 for multi-copy)
 *
 * Devnet environment variables (triggers custom chain setup):
 * - WARM_STORAGE_ADDRESS: Warm Storage service contract address
 * - WARM_STORAGE_VIEW_ADDRESS: Warm Storage state view contract address
 * - MULTICALL3_ADDRESS: Multicall3 address
 * - USDFC_ADDRESS: USDFC token address
 * - FILECOIN_PAY_ADDRESS: Filecoin Pay contract address
 * - SP_REGISTRY_ADDRESS: ServiceProviderRegistry address
 * - ENDORSEMENTS_ADDRESS: Endorsements contract address
 * - PDP_ADDRESS: PDP Verifier contract address
 *
 * Usage (calibnet - standard):
 *   PRIVATE_KEY=0x... node utils/example-storage-e2e.js <file-path> [file-path2] ...
 *
 * Usage (devnet):
 *   RUN_ID=$(jq -r '.run_id' ~/.foc-devnet/state/current_runid.json) && \
 *   CONTRACTS=~/.foc-devnet/run/$RUN_ID/contract_addresses.json && \
 *   PRIVATE_KEY=0x$(jq -r '.[] | select(.name=="USER_1") | .private_key' ~/.foc-devnet/keys/addresses.json) \
 *   RPC_URL=http://localhost:$(docker port foc-${RUN_ID}-lotus 1234 | cut -d: -f2)/rpc/v1 \
 *   NETWORK=devnet \
 *   WARM_STORAGE_ADDRESS=$(jq -r '.foc_contracts.filecoin_warm_storage_service_proxy' $CONTRACTS) \
 *   WARM_STORAGE_VIEW_ADDRESS=$(jq -r '.foc_contracts.filecoin_warm_storage_service_state_view' $CONTRACTS) \
 *   MULTICALL3_ADDRESS=$(jq -r '.contracts.multicall' $CONTRACTS) \
 *   USDFC_ADDRESS=$(jq -r '.contracts.usdfc' $CONTRACTS) \
 *   FILECOIN_PAY_ADDRESS=$(jq -r '.foc_contracts.filecoin_pay_v1_contract' $CONTRACTS) \
 *   SP_REGISTRY_ADDRESS=$(jq -r '.foc_contracts.service_provider_registry_proxy' $CONTRACTS) \
 *   ENDORSEMENTS_ADDRESS=$(jq -r '.foc_contracts.endorsements' $CONTRACTS) \
 *   PDP_ADDRESS=$(jq -r '.foc_contracts.p_d_p_verifier_proxy' $CONTRACTS) \
 *   node utils/example-storage-e2e.js README.md package.json
 */

import fs from 'fs'
import fsPromises from 'fs/promises'
import { Readable } from 'stream'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration, devnet, mainnet } from '../packages/synapse-core/src/chains.ts'
import { SIZE_CONSTANTS, Synapse } from '../packages/synapse-sdk/src/index.ts'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL
const COPY_COUNT = process.env.COPY_COUNT ? parseInt(process.env.COPY_COUNT, 10) : 2
const NETWORK = process.env.NETWORK || 'calibnet' // mainnet | calibnet | devnet

// Devnet overrides (see buildDevnetChain at bottom of file)
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS
const WARM_STORAGE_VIEW_ADDRESS = process.env.WARM_STORAGE_VIEW_ADDRESS
const MULTICALL3_ADDRESS = process.env.MULTICALL3_ADDRESS
const USDFC_ADDRESS = process.env.USDFC_ADDRESS
const FILECOIN_PAY_ADDRESS = process.env.FILECOIN_PAY_ADDRESS
const SP_REGISTRY_ADDRESS = process.env.SP_REGISTRY_ADDRESS
const ENDORSEMENTS_ADDRESS = process.env.ENDORSEMENTS_ADDRESS
const PDP_ADDRESS = process.env.PDP_ADDRESS

function printUsageAndExit() {
  console.error('Usage: PRIVATE_KEY=0x... node utils/example-storage-e2e.js <file-path> [file-path2] ...')
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
      files.push({ path: filePath, length: stat.size })
      totalSize += stat.size
    }

    const chain = NETWORK === 'devnet' ? buildDevnetChain() : NETWORK === 'mainnet' ? mainnet : calibration

    console.log('\n--- Initializing Synapse SDK ---')
    console.log(`Network: ${chain.name}`)
    if (RPC_URL) {
      console.log(`RPC URL: ${RPC_URL}`)
    }

    // Create account from private key
    const account = privateKeyToAccount(PRIVATE_KEY)
    console.log(`Wallet address: ${account.address}`)

    // Create Synapse instance
    // For calibnet/mainnet: chain has all contract addresses built-in
    // For devnet: chain is customized with environment variable addresses
    const synapse = Synapse.create({
      chain,
      account,
    })

    console.log('Synapse instance created')

    // Check balances
    console.log('\n--- Checking Balances ---')
    const filBalance = await synapse.payments.walletBalance()
    const usdfcBalance = await synapse.payments.walletBalance('USDFC')
    console.log(`FIL balance: ${Number(filBalance) / 1e18} FIL`)
    console.log(`USDFC balance: ${formatUSDFC(usdfcBalance)}`)

    // Run preflight checks
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

    // Upload files
    console.log('\n--- Uploading ---')
    console.log(`Uploading ${files.length} file(s) with ${COPY_COUNT} copies each...\n`)

    // uploadResults is built by either the single-file or multi-file path
    const uploadResults = []

    if (files.length === 1) {
      // ---------------------------------------------------------------
      // Single file: upload() handles everything
      // Uses streaming to avoid buffering the entire file in memory
      // ---------------------------------------------------------------
      const fileStream = Readable.toWeb(fs.createReadStream(files[0].path))
      console.log(`Uploading ${files[0].path} (${formatBytes(files[0].length)}) via stream...`)

      const result = await synapse.storage.upload(fileStream, {
        count: COPY_COUNT,
        callbacks: {
          onStored: (providerId, pieceCid) => {
            console.log(`  Stored on SP ${providerId}: ${pieceCid}`)
          },
          onUploadComplete: (pieceCid) => {
            console.log(`  Upload complete: ${pieceCid}`)
          },
          onCopyComplete: (providerId, pieceCid) => {
            console.log(`  Copied to SP ${providerId}: ${pieceCid}`)
          },
          onCopyFailed: (providerId, pieceCid, error) => {
            console.log(`  Copy failed on SP ${providerId}: ${pieceCid} - ${error.message}`)
          },
          onPieceAdded: (providerId, pieceCid) => {
            console.log(`  Piece submitted on SP ${providerId}: ${pieceCid}`)
          },
          onPieceConfirmed: (providerId, pieceCid, pieceId) => {
            console.log(`  Piece confirmed on SP ${providerId}: ${pieceCid} (pieceId: ${pieceId})`)
          },
        },
      })

      uploadResults.push({ file: files[0], result })
    } else {
      // ---------------------------------------------------------------
      // Multiple files: orchestrate store → pull → commit manually
      //
      // This is more efficient than calling upload() per file because
      // all pieces are committed in a single on-chain transaction per
      // provider, rather than one transaction per file.
      // ---------------------------------------------------------------

      // Create storage contexts — primary (endorsed) + secondaries
      const contexts = await synapse.storage.createContexts({ count: COPY_COUNT })
      const [primary, ...secondaries] = contexts
      console.log(`Primary: SP ${primary.provider.id}`)
      for (const sec of secondaries) {
        console.log(`Secondary: SP ${sec.provider.id}`)
      }

      // Store each file on the primary provider using streaming
      const stored = []
      for (const file of files) {
        const fileStream = Readable.toWeb(fs.createReadStream(file.path))
        console.log(`\nStoring ${file.path} (${formatBytes(file.length)}) via stream on SP ${primary.provider.id}...`)
        const storeResult = await primary.store(fileStream)
        console.log(`  Stored: ${storeResult.pieceCid}`)
        stored.push({ file, pieceCid: storeResult.pieceCid, size: storeResult.size })
      }

      // Pull all pieces to each secondary via SP-to-SP transfer.
      // Pre-sign extraData per secondary so the same signature is reused for
      // both the pull (estimateGas validation) and commit (on-chain submission),
      // avoiding a second wallet prompt.
      const pieceCids = stored.map((s) => s.pieceCid)
      const pieceInputs = stored.map((s) => ({ pieceCid: s.pieceCid }))
      const successfulSecondaries = []

      for (const secondary of secondaries) {
        console.log(`\nPulling ${pieceCids.length} piece(s) to SP ${secondary.provider.id}...`)
        try {
          const extraData = await secondary.presignForCommit(pieceInputs)
          const pullResult = await secondary.pull({ pieces: pieceCids, from: primary, extraData })

          if (pullResult.status === 'complete') {
            console.log(`  Pull complete`)
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
            retrievalUrl: primary.getPieceUrl(pieceCid),
            isNewDataSet: primaryCommit.isNewDataSet,
          },
          ...secondaryCommits.map(({ context, result }) => ({
            providerId: context.provider.id,
            dataSetId: result.dataSetId,
            pieceId: result.pieceIds[i],
            role: 'secondary',
            retrievalUrl: context.getPieceUrl(pieceCid),
            isNewDataSet: result.isNewDataSet,
          })),
        ]
        uploadResults.push({ file, result: { pieceCid, size, copies, failures: [] } })
      }
    }

    // Display upload summary
    console.log('\n--- Upload Summary ---')
    for (const { file, result } of uploadResults) {
      console.log(`\nFile: ${file.path}`)
      console.log(`  PieceCID: ${result.pieceCid}`)
      console.log(`  Size: ${formatBytes(result.size)}`)
      console.log(`  Copies: ${result.copies.length}/${COPY_COUNT}`)

      for (const copy of result.copies) {
        const roleLabel = copy.role === 'primary' ? '[Primary]  ' : '[Secondary]'
        console.log(
          `    ${roleLabel} Provider ${copy.providerId} - pieceId: ${copy.pieceId}, dataSetId: ${copy.dataSetId}`
        )
        console.log(`               Retrieval: ${copy.retrievalUrl}`)
      }

      if (result.failures.length > 0) {
        console.log(`  Failures: ${result.failures.length}`)
        for (const failure of result.failures) {
          console.log(`    Provider ${failure.providerId}: ${failure.error}`)
        }
      }
    }

    // Download and verify all files
    console.log('\n--- Downloading and Verifying ---')

    let allMatch = true
    for (const { file, result } of uploadResults) {
      console.log(`\nDownloading ${result.pieceCid}...`)

      // Use synapse.storage.download for SP-agnostic download
      // It will find any provider that has the piece
      const downloadedData = await synapse.storage.download(result.pieceCid)

      if (downloadedData == null) {
        console.error(`  FAILED: Could not download`)
        allMatch = false
        continue
      }

      // Verify against original
      const originalData = await fsPromises.readFile(file.path)
      const matches = Buffer.from(originalData).equals(Buffer.from(downloadedData))

      if (matches) {
        console.log(`  VERIFIED: ${formatBytes(downloadedData.length)} matches original`)
      } else {
        console.error(`  MISMATCH: Downloaded data does not match original!`)
        allMatch = false
      }
    }

    if (!allMatch) {
      console.error('\nERROR: One or more files failed verification!')
      process.exit(1)
    }

    console.log('\n=== SUCCESS: All files uploaded, replicated, and verified ===')
    console.log(`\nStored ${uploadResults.length} file(s) with ${COPY_COUNT} copies each.`)
    console.log('The service providers will periodically prove they still have your data.')
    console.log('You are being charged based on the storage size and duration.')
  } catch (error) {
    console.error('\nERROR:', error.message)
    if (error.cause) {
      console.error('Caused by:', error.cause.message)
    }
    console.error(error)
    process.exit(1)
  }
}

// Run the example
main().catch(console.error)

// =============================================================================
// DEVNET CHAIN BUILDER
// =============================================================================
// When running against foc-devnet, contract addresses are deployment-specific.
// This function builds a custom chain with addresses from environment variables.
// For calibnet/mainnet, the standard chain definitions have addresses built-in.

function buildDevnetChain() {
  console.log('\n--- Devnet Configuration ---')
  if (WARM_STORAGE_ADDRESS) console.log(`  FWSS: ${WARM_STORAGE_ADDRESS}`)
  if (WARM_STORAGE_VIEW_ADDRESS) console.log(`  FWSS View: ${WARM_STORAGE_VIEW_ADDRESS}`)
  if (MULTICALL3_ADDRESS) console.log(`  Multicall3: ${MULTICALL3_ADDRESS}`)
  if (USDFC_ADDRESS) console.log(`  USDFC: ${USDFC_ADDRESS}`)
  if (FILECOIN_PAY_ADDRESS) console.log(`  Filecoin Pay: ${FILECOIN_PAY_ADDRESS}`)
  if (SP_REGISTRY_ADDRESS) console.log(`  SP Registry: ${SP_REGISTRY_ADDRESS}`)
  if (ENDORSEMENTS_ADDRESS) console.log(`  Endorsements: ${ENDORSEMENTS_ADDRESS}`)
  if (PDP_ADDRESS) console.log(`  PDP: ${PDP_ADDRESS}`)

  return {
    ...devnet,
    rpcUrls: {
      default: { http: [RPC_URL || devnet.rpcUrls.default.http[0]] },
    },
    contracts: {
      ...devnet.contracts,
      ...(MULTICALL3_ADDRESS ? { multicall3: { address: MULTICALL3_ADDRESS, blockCreated: 0 } } : {}),
      ...(WARM_STORAGE_ADDRESS
        ? {
            fwss: {
              ...devnet.contracts.fwss,
              address: WARM_STORAGE_ADDRESS,
            },
          }
        : {}),
      ...(WARM_STORAGE_VIEW_ADDRESS
        ? {
            fwssView: {
              ...devnet.contracts.fwssView,
              address: WARM_STORAGE_VIEW_ADDRESS,
            },
          }
        : {}),
      ...(USDFC_ADDRESS
        ? {
            usdfc: {
              ...devnet.contracts.usdfc,
              address: USDFC_ADDRESS,
            },
          }
        : {}),
      ...(FILECOIN_PAY_ADDRESS
        ? {
            filecoinPay: {
              ...devnet.contracts.filecoinPay,
              address: FILECOIN_PAY_ADDRESS,
            },
          }
        : {}),
      ...(SP_REGISTRY_ADDRESS
        ? {
            serviceProviderRegistry: {
              ...devnet.contracts.serviceProviderRegistry,
              address: SP_REGISTRY_ADDRESS,
            },
          }
        : {}),
      ...(ENDORSEMENTS_ADDRESS
        ? {
            endorsements: {
              ...devnet.contracts.endorsements,
              address: ENDORSEMENTS_ADDRESS,
            },
          }
        : {}),
      ...(PDP_ADDRESS
        ? {
            pdp: {
              ...devnet.contracts.pdp,
              address: PDP_ADDRESS,
            },
          }
        : {}),
    },
  }
}
