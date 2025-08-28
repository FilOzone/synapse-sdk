#!/usr/bin/env node

/**
 * Example: Get Storage Information
 *
 * This example demonstrates how to use the Synapse SDK to retrieve
 * comprehensive storage service information including pricing,
 * providers, and current allowances.
 *
 * Usage:
 *   PRIVATE_KEY=0x... node example-storage-info.js
 */

import { Synapse } from '@filoz/synapse-sdk'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'

// Validate inputs
if (!PRIVATE_KEY) {
  console.error('ERROR: PRIVATE_KEY environment variable is required')
  console.error('Usage: PRIVATE_KEY=0x... node example-storage-info.js')
  process.exit(1)
}

// Helper to format USDFC amounts (18 decimals)
function formatUSDFC(amount) {
  const usdfc = Number(amount) / 1e18
  return `${usdfc.toFixed(6)} USDFC`
}

// Helper to format bytes for display
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

// Helper to format timestamp
function formatTimestamp(timestamp) {
  if (!timestamp || timestamp === 0) return 'N/A'
  return new Date(timestamp * 1000).toLocaleString()
}

async function main() {
  try {
    console.log('=== Synapse SDK Storage Info Example ===\n')

    // Initialize Synapse
    console.log('--- Initializing Synapse SDK ---')
    console.log(`RPC URL: ${RPC_URL}`)

    const synapse = await Synapse.create({
      privateKey: PRIVATE_KEY,
      rpcURL: RPC_URL,
    })
    console.log('✓ Synapse instance created')

    // Get wallet info
    const signer = synapse.getSigner()
    const address = await signer.getAddress()
    console.log(`Wallet address: ${address}`)

    // Get storage info
    console.log('\nFetching storage service information...')
    const storageInfo = await synapse.getStorageInfo()

    // Display pricing information
    console.log('\n--- Pricing Information ---')
    console.log(`Token: USDFC (${storageInfo.pricing.tokenAddress})`)
    console.log('\nWithout CDN:')
    console.log(`  Per TiB per month: ${formatUSDFC(storageInfo.pricing.noCDN.perTiBPerMonth)}`)
    console.log(`  Per TiB per day:   ${formatUSDFC(storageInfo.pricing.noCDN.perTiBPerDay)}`)
    console.log(`  Per TiB per epoch: ${formatUSDFC(storageInfo.pricing.noCDN.perTiBPerEpoch)}`)

    console.log('\nWith CDN:')
    console.log(`  Per TiB per month: ${formatUSDFC(storageInfo.pricing.withCDN.perTiBPerMonth)}`)
    console.log(`  Per TiB per day:   ${formatUSDFC(storageInfo.pricing.withCDN.perTiBPerDay)}`)
    console.log(`  Per TiB per epoch: ${formatUSDFC(storageInfo.pricing.withCDN.perTiBPerEpoch)}`)

    // Display service providers
    console.log('\n--- Service Providers ---')
    if (storageInfo.providers.length === 0) {
      console.log('No approved providers found')
    } else {
      console.log(`Total providers: ${storageInfo.providers.length}`)

      storageInfo.providers.forEach((provider, index) => {
        console.log(`\nProvider ${index + 1}:`)
        console.log(`  Address:    ${provider.serviceProvider}`)
        console.log(`  Service URL: ${provider.serviceURL}`)
        console.log(`  Peer ID:     ${provider.peerId}`)
        console.log(`  Registered: ${formatTimestamp(provider.registeredAt)}`)
        console.log(`  Approved:   ${formatTimestamp(provider.approvedAt)}`)
      })
    }

    // Display service parameters
    console.log('\n--- Service Parameters ---')
    console.log(`Network:          ${storageInfo.serviceParameters.network}`)
    console.log(`Epochs per month: ${storageInfo.serviceParameters.epochsPerMonth.toLocaleString()}`)
    console.log(`Epochs per day:   ${storageInfo.serviceParameters.epochsPerDay.toLocaleString()}`)
    console.log(`Epoch duration:   ${storageInfo.serviceParameters.epochDuration} seconds`)
    console.log(`Min upload size:  ${formatBytes(storageInfo.serviceParameters.minUploadSize)}`)
    console.log(`Max upload size:  ${formatBytes(storageInfo.serviceParameters.maxUploadSize)}`)
    console.log('\nContract Addresses:')
    console.log(`  Warm Storage: ${storageInfo.serviceParameters.warmStorageAddress}`)
    console.log(`  Payments:     ${storageInfo.serviceParameters.paymentsAddress}`)
    console.log(`  PDP Verifier: ${storageInfo.serviceParameters.pdpVerifierAddress}`)

    // Display current allowances
    console.log('\n--- Current Allowances ---')
    if (storageInfo.allowances) {
      console.log(`Service: ${storageInfo.allowances.service}`)
      console.log('\nRate:')
      console.log(`  Allowance:  ${formatUSDFC(storageInfo.allowances.rateAllowance)}`)
      console.log(`  Used:       ${formatUSDFC(storageInfo.allowances.rateUsed)}`)
      console.log(
        `  Available:  ${formatUSDFC(storageInfo.allowances.rateAllowance - storageInfo.allowances.rateUsed)}`
      )
      console.log('\nLockup:')
      console.log(`  Allowance:  ${formatUSDFC(storageInfo.allowances.lockupAllowance)}`)
      console.log(`  Used:       ${formatUSDFC(storageInfo.allowances.lockupUsed)}`)
      console.log(
        `  Available:  ${formatUSDFC(storageInfo.allowances.lockupAllowance - storageInfo.allowances.lockupUsed)}`
      )
    } else {
      console.log('No allowances found (wallet may not be connected or no approvals set)')
    }

    console.log('\n✅ Storage information retrieved successfully!')
  } catch (error) {
    console.error('\nERROR:', error.message)
    if (error.cause) {
      console.error('Caused by:', error.cause.message)
    }
    process.exit(1)
  }
}

// Run the example
main().catch(console.error)
