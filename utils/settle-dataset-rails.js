#!/usr/bin/env node

/**
 * Settle payment rails associated with a data set
 * Usage: node settle-dataset-rails.js <dataSetId>
 *
 * Environment variables:
 * - PRIVATE_KEY: Private key for signing transactions
 * - RPC_URL: RPC endpoint (defaults to calibration)
 */

import { ethers } from 'ethers'
import { SETTLEMENT_FEE, Synapse } from '../dist/index.js'
import { WarmStorageService } from '../dist/warm-storage/index.js'

async function main() {
  // Parse arguments
  const dataSetId = process.argv[2]
  if (!dataSetId) {
    console.error('Usage: node settle-dataset-rails.js <dataSetId>')
    process.exit(1)
  }

  // Get environment variables
  const privateKey = process.env.PRIVATE_KEY
  const rpcUrl = process.env.RPC_URL || 'wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1'

  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable is required')
    process.exit(1)
  }

  console.log('🔗 Connecting to:', rpcUrl)
  console.log('📊 Data Set ID:', dataSetId)
  console.log('')

  // Initialize SDK at the top level so we can access it later
  let synapse
  let hasError = false

  try {
    synapse = await Synapse.create({
      privateKey,
      rpcURL: rpcUrl,
    })

    // Get warm storage address and create service
    const warmStorageAddress = await synapse.getWarmStorageAddress()
    const warmStorage = await WarmStorageService.create(synapse.getProvider(), warmStorageAddress)

    console.log('📋 Fetching data set information...')

    // Get data set info to find rail IDs
    const dataSet = await warmStorage.getDataSet(Number(dataSetId))

    if (!dataSet) {
      console.error(`❌ Data set ${dataSetId} not found`)
      process.exit(1)
    }
    console.log('✅ Data set found:')
    console.log(`   Client: ${dataSet.payer}`)
    console.log(`   Provider: ${dataSet.serviceProvider}`)
    console.log(`   PDP Rail ID: ${dataSet.pdpRailId}`)
    console.log(`   CDN Rail ID: ${dataSet.cdnRailId}`)
    console.log(`   Cache Miss Rail ID: ${dataSet.cacheMissRailId}`)
    console.log('')

    // Collect all rail IDs to settle
    const railsToSettle = []

    if (dataSet.pdpRailId > 0) {
      railsToSettle.push({ type: 'PDP', id: dataSet.pdpRailId })
    }
    if (dataSet.cdnRailId > 0) {
      railsToSettle.push({ type: 'CDN', id: dataSet.cdnRailId })
    }
    if (dataSet.cacheMissRailId > 0) {
      railsToSettle.push({ type: 'Cache Miss', id: dataSet.cacheMissRailId })
    }

    if (railsToSettle.length === 0) {
      console.log('⚠️  No rails found for this data set')
      process.exit(0)
    }

    console.log(`💰 Checking settlement amounts for ${railsToSettle.length} rail(s)...`)

    // Display settlement fee
    console.log(`📍 Settlement fee per settlement: ${ethers.formatEther(SETTLEMENT_FEE)} FIL`)
    console.log('')

    let totalSettled = 0n
    let totalPayeeAmount = 0n
    let totalCommission = 0n
    const transactions = []

    // Process each rail
    for (const rail of railsToSettle) {
      console.log(`📊 ${rail.type} Rail (ID: ${rail.id}):`)

      try {
        // Preview settlement amounts
        const preview = await synapse.payments.getSettlementAmounts(rail.id)

        console.log(`   Total to settle: ${ethers.formatUnits(preview.totalSettledAmount, 18)} USDFC`)
        console.log(`   Payee receives:  ${ethers.formatUnits(preview.totalNetPayeeAmount, 18)} USDFC`)
        console.log(`   Commission:      ${ethers.formatUnits(preview.totalOperatorCommission, 18)} USDFC`)

        if (preview.totalSettledAmount === 0n) {
          console.log(`   ⏭️  Nothing to settle, skipping...`)
          console.log('')
          continue
        }

        // Settle the rail
        console.log(`   🔄 Settling rail...`)
        const tx = await synapse.payments.settle(rail.id)
        console.log(`   📝 Transaction: ${tx.hash}`)

        // Wait for confirmation
        console.log(`   ⏳ Waiting for confirmation...`)
        const receipt = await tx.wait()
        console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`)
        console.log('')

        // Track totals
        totalSettled += preview.totalSettledAmount
        totalPayeeAmount += preview.totalNetPayeeAmount
        totalCommission += preview.totalOperatorCommission
        transactions.push({
          type: rail.type,
          railId: rail.id,
          txHash: tx.hash,
          amount: preview.totalSettledAmount,
        })
      } catch (error) {
        console.error(`   ❌ Error settling ${rail.type} rail:`, error.message)

        // Check if it's the InsufficientNativeTokenForBurn error
        if (error.message.includes('InsufficientNativeTokenForBurn')) {
          console.log(`   ℹ️  This error means your wallet doesn't have enough FIL for the network fee`)
          console.log(`   ℹ️  Settlement requires ${ethers.formatEther(networkFee)} FIL as a network fee`)
          console.log(`   ℹ️  Please ensure your wallet has sufficient FIL balance`)
        }

        console.log('')
      }
    }

    // Summary
    console.log('═══════════════════════════════════════════')
    console.log('📊 SETTLEMENT SUMMARY')
    console.log('═══════════════════════════════════════════')
    console.log(`Total Settled:     ${ethers.formatUnits(totalSettled, 18)} USDFC`)
    console.log(`Payee Received:    ${ethers.formatUnits(totalPayeeAmount, 18)} USDFC`)
    console.log(`Total Commission:  ${ethers.formatUnits(totalCommission, 18)} USDFC`)
    console.log('')

    if (transactions.length > 0) {
      console.log('📝 Transactions:')
      for (const tx of transactions) {
        console.log(`   ${tx.type}: ${tx.txHash}`)
      }
    }

    console.log('')
    console.log('✅ Settlement complete!')
  } catch (error) {
    console.error('❌ Error:', error.message)
    hasError = true
  } finally {
    // Always close the WebSocket connection if it exists
    if (synapse) {
      const provider = synapse.getProvider()
      if (provider && typeof provider.destroy === 'function') {
        await provider.destroy()
      }
    }

    // Exit with appropriate code
    process.exit(hasError ? 1 : 0)
  }
}

// Run the script
main().catch((error) => {
  console.error('❌ Fatal error:', error.message)
  process.exit(1)
})
