#!/usr/bin/env node

/**
 * Piece Details Example - Demonstrates how to get piece information directly from blockchain
 *
 * This example shows how to use the blockchain-based piece retrieval to get
 * authoritative piece data directly from the PDPVerifier contract.
 *
 * The script will:
 * 1. Find your data sets
 * 2. Get piece information directly from PDPVerifier contract (source of truth)
 * 3. Extract raw sizes from the PieceCID metadata
 * 4. Display a summary of all pieces with their calculated sizes
 *
 * Usage:
 *   PRIVATE_KEY=0x... node example-piece-details.js
 */

import { Synapse } from '@filoz/synapse-sdk'
import { getSizeFromPieceCID } from '@filoz/synapse-sdk/piece'

const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS // Optional - will use default for network

if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY environment variable is required')
  console.error('Usage: PRIVATE_KEY=0x... node example-piece-details.js')
  process.exit(1)
}

async function main() {
  console.log('=== Synapse SDK Piece Details Example ===\n')

  // Create Synapse instance
  const synapseOptions = {
    privateKey: PRIVATE_KEY,
    rpcURL: RPC_URL,
  }

  if (WARM_STORAGE_ADDRESS) {
    synapseOptions.warmStorageAddress = WARM_STORAGE_ADDRESS
  }

  const synapse = await Synapse.create(synapseOptions)
  console.log('✅ Synapse instance created')

  // Declare dataSetInfo in the outer scope
  let dataSetInfo = null

  try {
    // Find data sets with pieces
    console.log('\n📊 Finding data sets...')
    const dataSets = await synapse.storage.findDataSets()
    console.log(`Found ${dataSets.length} data set(s)`)

    if (dataSets.length === 0) {
      console.log('❌ No data sets found. Please upload some data first using example-storage-simple.js')
      return
    }

    // Find a data set with pieces (currentPieceCount > 0)
    const dataSetWithPieces = dataSets.find((ds) => ds.currentPieceCount > 0)
    if (!dataSetWithPieces) {
      console.log('❌ No data sets with pieces found. Please upload some data first using example-storage-simple.js')
      return
    }

    // Map the data set properties to what we expect
    dataSetInfo = {
      dataSetId: dataSetWithPieces.pdpVerifierDataSetId,
      providerId: dataSetWithPieces.providerId,
      pieceCount: dataSetWithPieces.currentPieceCount,
      clientDataSetId: dataSetWithPieces.clientDataSetId,
      isLive: dataSetWithPieces.isLive,
      withCDN: dataSetWithPieces.withCDN,
    }

    console.log(`\n📊 Data Set Summary:`)
    console.log(`  PDP Verifier Data Set ID: ${dataSetInfo.dataSetId}`)
    console.log(`  Client Data Set ID: ${dataSetInfo.clientDataSetId}`)
    console.log(`  Provider ID: ${dataSetInfo.providerId}`)
    console.log(`  Piece Count: ${dataSetInfo.pieceCount}`)
    console.log(`  Is Live: ${dataSetInfo.isLive}`)
    console.log(`  With CDN: ${dataSetInfo.withCDN}`)

    // Get all pieces directly from blockchain
    console.log('\n--- Getting Pieces from Blockchain (PDPVerifier) ---')
    try {
      const context = await synapse.storage.createContext({
        dataSetId: dataSetInfo.dataSetId,
        providerId: dataSetInfo.providerId,
      })

      // Collect all pieces using the generator
      const pieces = []
      for await (const { pieceCid, pieceId } of context.getPieces()) {
        const rawSize = getSizeFromPieceCID(pieceCid)
        pieces.push({ pieceCid, pieceId, rawSize })
      }

      console.log(`✅ Retrieved ${pieces.length} pieces from blockchain:`)

      pieces.forEach((piece, index) => {
        console.log(`\n  Piece ${index + 1}:`)
        console.log(`    ID: ${piece.pieceId}`)
        console.log(`    CID: ${piece.pieceCid}`)
        console.log(`    Raw Size: ${piece.rawSize} bytes (${(piece.rawSize / 1024).toFixed(2)} KB)`)
      })

      // Calculate totals
      const totalRawSize = pieces.reduce((sum, piece) => sum + piece.rawSize, 0)

      console.log(`\n📈 Data Set Summary:`)
      console.log(`   Total Pieces: ${pieces.length}`)
      console.log(`   Total Raw Size: ${totalRawSize} bytes (${(totalRawSize / 1024).toFixed(2)} KB)`)
      console.log(`   Average Piece Size: ${(totalRawSize / pieces.length).toFixed(2)} bytes`)
    } catch (error) {
      console.error('❌ Error getting pieces from blockchain:', error.message)
    }
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

main().catch(console.error)
