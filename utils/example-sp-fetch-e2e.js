#!/usr/bin/env node

/**
 * Example: SP-to-SP Piece Fetch End-to-End Test
 *
 * This example demonstrates the SP-to-SP fetch functionality:
 * 1. Upload a piece to SP1 (providerId=1) using low-level park API (no AddPieces)
 * 2. Wait for SP1 to park the piece
 * 3. Request SP2 (providerId=2) to fetch the piece from SP1
 * 4. Poll until the fetch completes
 * 5. Verify SP2 can serve the piece
 *
 * This tests:
 * - curio: POST /pdp/piece/fetch endpoint
 * - synapse-sdk: sp-fetch module
 *
 * Required environment variables:
 * - PRIVATE_KEY: Your private key (with 0x prefix)
 * - RPC_URL: Filecoin RPC endpoint (defaults to calibration)
 *
 * Optional environment variables (for devnet):
 * - WARM_STORAGE_ADDRESS: Warm Storage service contract address
 * - MULTICALL3_ADDRESS: Multicall3 address (required for devnet)
 * - USDFC_ADDRESS: USDFC token address
 *
 * Usage:
 *   PRIVATE_KEY=0x... node example-sp-fetch-e2e.js <file-path>
 *
 * With foc-devnet:
 *   RUN_ID=$(jq -r '.run_id' ~/.foc-devnet/state/current_runid.json)
 *   PRIVATE_KEY=0x$(jq -r '.[] | select(.name=="USER_1") | .private_key' ~/.foc-devnet/keys/addresses.json) \
 *   RPC_URL=http://localhost:$(docker port foc-${RUN_ID}-lotus 1234 | cut -d: -f2)/rpc/v1 \
 *   WARM_STORAGE_ADDRESS=$(jq -r '.foc_contracts.filecoin_warm_storage_service_proxy' ~/.foc-devnet/state/latest/contract_addresses.json) \
 *   MULTICALL3_ADDRESS=$(jq -r '.contracts.multicall' ~/.foc-devnet/state/latest/contract_addresses.json) \
 *   USDFC_ADDRESS=$(jq -r '.contracts.usdfc' ~/.foc-devnet/state/latest/contract_addresses.json) \
 *   SP_REGISTRY_ADDRESS=$(jq -r '.foc_contracts.service_provider_registry_proxy' ~/.foc-devnet/state/latest/contract_addresses.json) \
 *   node utils/example-sp-fetch-e2e.js test-file.txt
 */

import { ethers } from 'ethers'
import fsPromises from 'fs/promises'
import * as SP from '../packages/synapse-core/src/sp.ts'
import * as spFetch from '../packages/synapse-core/src/sp-fetch.ts'
import { randU256 } from '../packages/synapse-core/src/utils/rand.ts'
import { Synapse } from '../packages/synapse-sdk/src/index.ts'
import { PDPAuthHelper } from '../packages/synapse-sdk/src/pdp/auth.ts'
import { SPRegistryService } from '../packages/synapse-sdk/src/sp-registry/service.ts'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS
const MULTICALL3_ADDRESS = process.env.MULTICALL3_ADDRESS
const USDFC_ADDRESS = process.env.USDFC_ADDRESS
const SP_REGISTRY_ADDRESS = process.env.SP_REGISTRY_ADDRESS

function printUsageAndExit() {
  console.error('Usage: PRIVATE_KEY=0x... node example-sp-fetch-e2e.js <file-path>')
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

/**
 * Encode CreateDataSet extra data for the fetch API (when dataSetId=0)
 * Format: (address payer, uint256 clientDataSetId, string[] keys, string[] values, bytes signature)
 */
function encodeCreateDataSetExtraData(payer, clientDataSetId, metadata, signature) {
  const sig = signature.startsWith('0x') ? signature : `0x${signature}`
  const keys = metadata.map((entry) => entry.key)
  const values = metadata.map((entry) => entry.value)

  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  return abiCoder.encode(
    ['address', 'uint256', 'string[]', 'string[]', 'bytes'],
    [payer, clientDataSetId, keys, values, sig]
  )
}

/**
 * Encode AddPieces extra data for the fetch API
 * Format: (uint256 nonce, string[][] metadataKeys, string[][] metadataValues, bytes signature)
 */
function encodeAddPiecesExtraData(nonce, metadata, signature) {
  const sig = signature.startsWith('0x') ? signature : `0x${signature}`
  const keys = metadata.map((item) => item.map((entry) => entry.key))
  const values = metadata.map((item) => item.map((entry) => entry.value))

  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  return abiCoder.encode(['uint256', 'string[][]', 'string[][]', 'bytes'], [nonce, keys, values, sig])
}

/**
 * Encode combined extraData for creating a new data set with pieces (dataSetId=0)
 * Format: abi.encode(bytes createPayload, bytes addPayload)
 */
function encodeCombinedExtraData(createExtraData, addExtraData) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  return abiCoder.encode(['bytes', 'bytes'], [createExtraData, addExtraData])
}

async function main() {
  try {
    console.log('=== SP-to-SP Fetch E2E Test ===\n')
    console.log(`Processing ${filePaths.length} file(s)...`)

    // Read all files and get their stats
    const fileInfos = await Promise.all(
      filePaths.map(async (filePath) => {
        const stat = await fsPromises.stat(filePath)
        if (!stat.isFile()) {
          throw new Error(`Path is not a file: ${filePath}`)
        }
        console.log(`  ${filePath}: ${formatBytes(stat.size)}`)
        return { filePath, size: stat.size }
      })
    )

    // Create Synapse instance
    console.log('\n--- Initializing Synapse SDK ---')
    console.log(`RPC URL: ${RPC_URL}`)

    const synapseOptions = {
      multicall3Address: MULTICALL3_ADDRESS,
      privateKey: PRIVATE_KEY,
      rpcURL: RPC_URL,
      usdfcAddress: USDFC_ADDRESS,
      warmStorageAddress: WARM_STORAGE_ADDRESS,
    }

    if (WARM_STORAGE_ADDRESS) {
      console.log(`Warm Storage Address: ${WARM_STORAGE_ADDRESS}`)
    }
    if (MULTICALL3_ADDRESS) {
      console.log(`Multicall3 Address: ${MULTICALL3_ADDRESS}`)
    }

    const synapse = await Synapse.create(synapseOptions)
    console.log('Synapse instance created')

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

    // Get SP1 and SP2 info
    console.log('\n--- Discovering Service Providers ---')
    console.log(`SP Registry Address: ${SP_REGISTRY_ADDRESS}`)
    const spRegistry = new SPRegistryService(synapse.getProvider(), SP_REGISTRY_ADDRESS, MULTICALL3_ADDRESS)
    const sp1Info = await spRegistry.getProvider(1)
    const sp2Info = await spRegistry.getProvider(2)

    if (!sp1Info || !sp1Info.products.PDP?.data.serviceURL) {
      throw new Error('SP1 (providerId=1) not found or missing PDP service URL')
    }
    if (!sp2Info || !sp2Info.products.PDP?.data.serviceURL) {
      throw new Error('SP2 (providerId=2) not found or missing PDP service URL')
    }

    const sp1Url = sp1Info.products.PDP.data.serviceURL.replace(/\/$/, '')
    const sp2Url = sp2Info.products.PDP.data.serviceURL.replace(/\/$/, '')

    console.log(`SP1 (providerId=1): ${sp1Info.name}`)
    console.log(`  Address: ${sp1Info.serviceProvider}`)
    console.log(`  PDP URL: ${sp1Url}`)
    console.log(`SP2 (providerId=2): ${sp2Info.name}`)
    console.log(`  Address: ${sp2Info.serviceProvider}`)
    console.log(`  PDP URL: ${sp2Url}`)

    // Upload all pieces to SP1 in parallel
    console.log('\n--- Uploading Pieces to SP1 (Park Only) ---')
    const uploadResults = await Promise.all(
      fileInfos.map(async ({ filePath, size }) => {
        const fileHandle = await fsPromises.open(filePath, 'r')
        const fileData = fileHandle.readableWebStream()

        console.log(`  Uploading ${filePath}...`)
        const result = await SP.uploadPieceStreaming({
          endpoint: sp1Url,
          data: fileData,
          size: size,
        })
        await fileHandle.close()

        const pieceCid = result.pieceCid.toString()
        console.log(`    ${filePath} -> ${pieceCid.slice(0, 30)}... (${formatBytes(result.size)})`)
        return { filePath, pieceCid, size: result.size }
      })
    )

    console.log(`\nUploaded ${uploadResults.length} piece(s) to SP1`)

    // Wait for all pieces to be parked on SP1
    console.log('\n--- Waiting for SP1 to park all pieces ---')
    await Promise.all(
      uploadResults.map(async ({ pieceCid }) => {
        await SP.findPiece({
          endpoint: sp1Url,
          pieceCid: pieceCid,
        })
        console.log(`  Parked: ${pieceCid.slice(0, 30)}...`)
      })
    )
    console.log('All pieces parked on SP1')

    // Get FWSS address for recordKeeper
    const fwssAddress = synapse.getWarmStorageAddress()
    console.log(`\nFWSS Address (recordKeeper): ${fwssAddress}`)

    // Prepare extraData for fetch request
    console.log('\n--- Preparing Fetch Request ---')

    // For dataSetId=0 (create new), we need both CreateDataSet and AddPieces signatures
    const authHelper = new PDPAuthHelper(fwssAddress, signer, BigInt(synapse.getChainId()))
    const clientDataSetId = 0n // New dataset
    const nonce = randU256()
    const pieceCids = uploadResults.map((r) => r.pieceCid)
    const datasetMetadata = [] // Empty metadata for dataset
    const pieceMetadata = uploadResults.map(() => []) // Empty metadata for each piece

    console.log(`Client: ${address}`)
    console.log(`Payee (SP2): ${sp2Info.serviceProvider}`)
    console.log(`Client Dataset ID: ${clientDataSetId}`)
    console.log(`Nonce: ${nonce}`)
    console.log(`PieceCIDs: ${pieceCids.length} pieces`)
    for (const cid of pieceCids) {
      console.log(`  - ${cid.slice(0, 40)}...`)
    }

    // Sign CreateDataSet (authorizes creating a new dataset with SP2 as payee)
    console.log(`\nSigning CreateDataSet...`)
    const createAuthData = await authHelper.signCreateDataSet(clientDataSetId, sp2Info.serviceProvider, datasetMetadata)
    console.log(`  CreateDataSet signature: ${createAuthData.signature.slice(0, 20)}...`)

    // Sign AddPieces (authorizes adding these pieces to the dataset)
    console.log(`Signing AddPieces...`)
    const addAuthData = await authHelper.signAddPieces(clientDataSetId, nonce, pieceCids, pieceMetadata)
    console.log(`  AddPieces signature: ${addAuthData.signature.slice(0, 20)}...`)

    // Encode CreateDataSet extraData
    const createExtraData = encodeCreateDataSetExtraData(
      address, // payer
      clientDataSetId,
      datasetMetadata,
      createAuthData.signature
    )

    // Encode AddPieces extraData
    const addExtraData = encodeAddPiecesExtraData(nonce, pieceMetadata, addAuthData.signature)

    // Combine for dataSetId=0 case
    const extraData = encodeCombinedExtraData(createExtraData, addExtraData)
    console.log(`  Combined extraData encoded (${extraData.length} chars)`)

    // Initiate fetch from SP2
    console.log('\n--- Initiating Fetch from SP2 ---')
    console.log(`Target SP2 URL: ${sp2Url}`)
    console.log(`Requesting SP2 to fetch ${uploadResults.length} piece(s) from SP1...`)

    // Build pieces array with source URLs for each piece
    const piecesToFetch = uploadResults.map(({ pieceCid }) => ({
      pieceCid: pieceCid,
      sourceUrl: `${sp1Url}/piece/${pieceCid}`,
    }))

    const fetchResult = await spFetch.pollStatus({
      endpoint: sp2Url,
      recordKeeper: fwssAddress,
      extraData: extraData,
      dataSetId: 0n, // Create new (for validation only)
      pieces: piecesToFetch,
      onStatus: (response) => {
        console.log(`  Fetch status: ${response.status}`)
        for (const piece of response.pieces) {
          console.log(`    ${piece.pieceCid.slice(0, 20)}...: ${piece.status}`)
        }
      },
      minTimeout: 2000, // Poll every 2 seconds
    })

    console.log(`\nFetch completed with status: ${fetchResult.status}`)

    if (fetchResult.status === 'complete') {
      console.log('\n--- Verifying SP2 has all pieces ---')

      let allMatched = true
      for (const { filePath, pieceCid } of uploadResults) {
        const sp2PieceUrl = `${sp2Url}/piece/${pieceCid}`
        console.log(`\nDownloading ${pieceCid.slice(0, 30)}... from SP2`)

        const downloadResponse = await fetch(sp2PieceUrl)
        if (downloadResponse.ok) {
          const downloadedData = await downloadResponse.arrayBuffer()
          console.log(`  Downloaded ${formatBytes(downloadedData.byteLength)}`)

          // Compare with original file
          const originalData = await fsPromises.readFile(filePath)
          const matches = Buffer.from(originalData).equals(Buffer.from(downloadedData))

          if (matches) {
            console.log(`  MATCH: ${filePath}`)
          } else {
            console.error(`  MISMATCH: ${filePath}`)
            allMatched = false
          }
        } else {
          console.error(`  ERROR: Failed to download: ${downloadResponse.status}`)
          const errorText = await downloadResponse.text()
          console.error(`  Response: ${errorText}`)
          allMatched = false
        }
      }

      if (allMatched) {
        console.log(`\nSUCCESS: All ${uploadResults.length} pieces verified on SP2!`)
      } else {
        console.error('\nERROR: Some pieces did not match!')
        process.exit(1)
      }
    } else if (fetchResult.status === 'failed') {
      console.error('\nERROR: Fetch failed!')
      for (const piece of fetchResult.pieces) {
        console.error(`  ${piece.pieceCid}: ${piece.status}`)
      }
      process.exit(1)
    }

    console.log('\n=== SP-to-SP Fetch Test Complete ===')
  } catch (error) {
    console.error('\nERROR:', error.message)
    if (error.cause) {
      console.error('Caused by:', error.cause.message)
    }
    console.error(error)
    process.exit(1)
  }
}

// Run the test
main().catch(console.error)
