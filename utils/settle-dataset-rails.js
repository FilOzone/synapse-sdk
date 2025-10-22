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
import { SETTLEMENT_FEE, Synapse } from '../packages/synapse-sdk/src/index.ts'
import { getCurrentEpoch } from '../packages/synapse-sdk/src/utils/index.ts'
import { WarmStorageService } from '../packages/synapse-sdk/src/warm-storage/index.ts'

// ANSI color codes
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const RED = '\x1b[31m'

// Configuration for batch settlement
// Maximum tested batch size to avoid gas limit in validator's epoch loop
const DAYS = 6n // Number of days per batch (7 days currently exceeds block gas limit)
const EPOCHS_PER_DAY = 2880n
const BATCH_SIZE = EPOCHS_PER_DAY * DAYS

/**
 * Execute a settlement for a rail, optionally to a specific epoch
 * @returns {Object|null} Settlement result with preview, tx, receipt, or null if nothing to settle
 */
async function executeSettlement(synapse, rail, targetEpoch = null, batchNumber = null) {
  const indent = batchNumber ? '    ' : '  '
  const batchLabel = batchNumber ? ` (Batch ${batchNumber})` : ''

  // Get settlement preview
  const preview = targetEpoch
    ? await synapse.payments.getSettlementAmounts(rail.id, targetEpoch)
    : await synapse.payments.getSettlementAmounts(rail.id)

  // Log settlement amounts
  if (batchNumber) {
    console.log(`${indent}Amount:  ${ethers.formatUnits(preview.totalSettledAmount, 18)} USDFC`)
  } else {
    console.log(`${indent}Total to settle: ${ethers.formatUnits(preview.totalSettledAmount, 18)} USDFC`)
    console.log(`${indent}Payee receives:  ${ethers.formatUnits(preview.totalNetPayeeAmount, 18)} USDFC`)
    console.log(`${indent}Commission:      ${ethers.formatUnits(preview.totalOperatorCommission, 18)} USDFC`)
  }

  // Nothing to settle
  if (preview.totalSettledAmount === 0n) {
    console.log(`${indent}${DIM}Nothing to settle${RESET}`)
    console.log('')
    return null
  }

  // Execute settlement
  console.log(`${indent}Settling...`)
  const tx = targetEpoch ? await synapse.payments.settle(rail.id, targetEpoch) : await synapse.payments.settle(rail.id)
  console.log(`${indent}Tx: ${tx.hash}`)

  // Wait for confirmation
  const receipt = await tx.wait()
  console.log(`${indent}${GREEN}Confirmed in block ${receipt.blockNumber}${RESET}`)
  console.log('')

  return {
    preview,
    tx,
    receipt,
    type: `${rail.type}${batchLabel}`,
  }
}

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

  console.log(`${CYAN}Connecting to:${RESET} ${rpcUrl}`)
  console.log(`${CYAN}Data Set ID:${RESET} ${dataSetId}`)
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

    console.log('Fetching data set information...')

    // Get data set info to find rail IDs
    const dataSet = await warmStorage.getDataSet(Number(dataSetId))

    if (!dataSet) {
      console.error(`${RED}Error: Data set ${dataSetId} not found${RESET}`)
      process.exit(1)
    }
    console.log(`${GREEN}Data set found${RESET}`)
    console.log(`  Client:          ${dataSet.payer}`)
    console.log(`  Provider:        ${dataSet.serviceProvider}`)
    console.log(`  PDP Rail ID:     ${dataSet.pdpRailId}`)
    console.log(`  CDN Rail ID:     ${dataSet.cdnRailId}`)
    console.log(`  Cache Miss Rail: ${dataSet.cacheMissRailId}`)
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
      console.log(`${YELLOW}No rails found for this data set${RESET}`)
      process.exit(0)
    }

    console.log(`Checking settlement amounts for ${railsToSettle.length} rail(s)...`)
    console.log(`${DIM}Settlement fee: ${ethers.formatEther(SETTLEMENT_FEE)} FIL per transaction${RESET}`)
    console.log('')

    let totalSettled = 0n
    let totalPayeeAmount = 0n
    let totalCommission = 0n
    const transactions = []

    // Get current epoch
    const currentEpoch = await getCurrentEpoch(synapse.getProvider())
    console.log(`Current epoch: ${currentEpoch}`)
    console.log('')

    // Process each rail
    for (const rail of railsToSettle) {
      console.log(`${BOLD}${rail.type} Rail (ID: ${rail.id})${RESET}`)

      try {
        // Get rail info to check settled epoch
        const railInfo = await synapse.payments.getRail(rail.id)
        const settledUpTo = railInfo.settledUpTo
        const epochGap = currentEpoch - settledUpTo

        console.log(`  Settled up to: ${settledUpTo}`)
        console.log(`  Epoch gap:     ${epochGap} epochs`)

        // Determine if we need to batch
        const needsBatching = epochGap > BATCH_SIZE

        if (needsBatching) {
          console.log(`  ${YELLOW}Large gap - settling in batches of ${BATCH_SIZE} epochs (${DAYS} days)${RESET}`)
          console.log('')

          // Settle in batches
          let batchStart = settledUpTo
          let batchNumber = 1

          while (batchStart < currentEpoch) {
            const batchEnd = batchStart + BATCH_SIZE
            const targetEpoch = batchEnd > currentEpoch ? currentEpoch : batchEnd

            console.log(`  ${CYAN}Batch ${batchNumber}:${RESET} Epochs ${batchStart} → ${targetEpoch}`)

            const result = await executeSettlement(synapse, rail, targetEpoch, batchNumber)

            if (result) {
              // Track totals
              totalSettled += result.preview.totalSettledAmount
              totalPayeeAmount += result.preview.totalNetPayeeAmount
              totalCommission += result.preview.totalOperatorCommission
              transactions.push({
                type: result.type,
                railId: rail.id,
                txHash: result.tx.hash,
                amount: result.preview.totalSettledAmount,
              })
            }

            batchStart = targetEpoch
            batchNumber++
          }
        } else {
          // Normal single settlement
          const result = await executeSettlement(synapse, rail)

          if (result) {
            // Track totals
            totalSettled += result.preview.totalSettledAmount
            totalPayeeAmount += result.preview.totalNetPayeeAmount
            totalCommission += result.preview.totalOperatorCommission
            transactions.push({
              type: result.type,
              railId: rail.id,
              txHash: result.tx.hash,
              amount: result.preview.totalSettledAmount,
            })
          }
        }
      } catch (error) {
        console.error(`  ${RED}Error settling ${rail.type} rail: ${error.message}${RESET}`)

        // Check if it's the InsufficientNativeTokenForBurn error
        if (error.message.includes('InsufficientNativeTokenForBurn')) {
          console.log(`  ${YELLOW}Insufficient FIL for network fee${RESET}`)
          console.log(`  Required: ${ethers.formatEther(SETTLEMENT_FEE)} FIL`)
        }

        console.log('')
      }
    }

    // Summary
    console.log('')
    console.log(`${BOLD}Settlement Summary${RESET}`)
    console.log('─'.repeat(60))
    console.log(`Total Settled:     ${ethers.formatUnits(totalSettled, 18)} USDFC`)
    console.log(`Payee Received:    ${ethers.formatUnits(totalPayeeAmount, 18)} USDFC`)
    console.log(`Total Commission:  ${ethers.formatUnits(totalCommission, 18)} USDFC`)
    console.log('')

    if (transactions.length > 0) {
      console.log('Transactions:')
      for (const tx of transactions) {
        console.log(`  ${tx.type}: ${tx.txHash}`)
      }
    }

    console.log('')
    console.log(`${GREEN}Settlement complete${RESET}`)
  } catch (error) {
    console.error(`${RED}Error: ${error.message}${RESET}`)
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
  console.error(`${RED}Fatal error: ${error.message}${RESET}`)
  process.exit(1)
})
