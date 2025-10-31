#!/usr/bin/env node

/**
 * Example: Get Storage Information
 *
 * This example demonstrates how to use the Synapse SDK to retrieve
 * comprehensive storage service information including pricing,
 * providers, current allowances, and data sets.
 *
 * Usage:
 *   PRIVATE_KEY=0x... node example-storage-info.js
 *
 * Optional:
 *   WARM_STORAGE_ADDRESS=0x... (defaults to network default)
 */

import { Synapse, WarmStorageService } from '@filoz/synapse-sdk'

// Configuration from environment
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const WARM_STORAGE_ADDRESS = process.env.WARM_STORAGE_ADDRESS // Optional - will use default for network

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

async function main() {
  try {
    console.log('=== Synapse SDK Storage Info Example ===\n')

    // Initialize Synapse
    console.log('--- Initializing Synapse SDK ---')
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

    // Get service info
    console.log('\nFetching storage service information...')
    const serviceInfo = await synapse.storage.getServiceInfo()

    // Display pricing information
    console.log('\n--- Pricing Information ---')
    console.log(`Token: ${serviceInfo.pricing.tokenSymbol} (${serviceInfo.pricing.tokenAddress})`)
    console.log('\nBase Storage:')
    console.log(`  Per TiB per month:        ${formatUSDFC(serviceInfo.pricing.storagePricePerTiBPerMonth)}`)
    console.log(`  Minimum price per month:  ${formatUSDFC(serviceInfo.pricing.minimumPricePerMonth)}`)

    console.log('\nCDN Usage-Based Pricing (only for data sets with CDN enabled):')
    console.log(`  CDN egress per TiB:       ${formatUSDFC(serviceInfo.pricing.cdnEgressPricePerTiB)}`)
    console.log(`  Cache miss egress per TiB: ${formatUSDFC(serviceInfo.pricing.cacheMissEgressPricePerTiB)}`)

    // Display service providers
    console.log('\n--- Service Providers ---')
    if (serviceInfo.providers.length === 0) {
      console.log('No approved providers found')
    } else {
      console.log(`Total providers: ${serviceInfo.providers.length}`)

      for (const [_index, provider] of serviceInfo.providers.entries()) {
        console.log(`\nProvider #${provider.id}:`)
        console.log(`  Name:        ${provider.name}`)
        console.log(`  Description: ${provider.description}`)
        console.log(`  Address:     ${provider.serviceProvider}`)
        console.log(`  Payee:       ${provider.payee}`)
        console.log(`  Active:      ${provider.active}`)

        // Show PDP product details if available
        const pdpProduct = provider.products.PDP
        if (pdpProduct?.isActive) {
          console.log(`  Service URL: ${pdpProduct.data.serviceURL}`)
          console.log(`  PDP Service:`)
          console.log(`    Min size:  ${formatBytes(Number(pdpProduct.data.minPieceSizeInBytes))}`)
          console.log(`    Max size:  ${formatBytes(Number(pdpProduct.data.maxPieceSizeInBytes))}`)
          const price = pdpProduct.data.storagePricePerTiBPerMonth
          console.log(`    Price:     ${price > 0 ? formatUSDFC(price) : '0.000000 USDFC'}/TiB/month`)
          console.log(`    Location:  ${pdpProduct.data.location}`)
        }
      }
    }

    // Display service parameters
    console.log('\n--- Service Parameters ---')
    console.log(`Network:          ${serviceInfo.serviceParameters.network}`)
    console.log(`Epochs per month: ${serviceInfo.serviceParameters.epochsPerMonth.toLocaleString()}`)
    console.log(`Epochs per day:   ${serviceInfo.serviceParameters.epochsPerDay.toLocaleString()}`)
    console.log(`Epoch duration:   ${serviceInfo.serviceParameters.epochDuration} seconds`)
    console.log(`Min upload size:  ${formatBytes(serviceInfo.serviceParameters.minUploadSize)}`)
    console.log(`Max upload size:  ${formatBytes(serviceInfo.serviceParameters.maxUploadSize)}`)
    console.log('\nContract Addresses:')
    console.log(`  Warm Storage:                  ${serviceInfo.serviceParameters.warmStorageAddress}`)
    console.log(`  Payments:                      ${serviceInfo.serviceParameters.paymentsAddress}`)
    console.log(`  PDP Verifier:                  ${serviceInfo.serviceParameters.pdpVerifierAddress}`)
    console.log(`  Service Provider Registry:     ${serviceInfo.serviceParameters.serviceProviderRegistryAddress}`)
    console.log(`  Session Key Registry:          ${serviceInfo.serviceParameters.sessionKeyRegistryAddress}`)

    // Display current allowances
    console.log('\n--- Current Allowances ---')
    if (serviceInfo.allowances) {
      console.log(`Service: ${serviceInfo.allowances.service}`)
      console.log('\nRate:')
      console.log(`  Allowance:  ${formatUSDFC(serviceInfo.allowances.rateAllowance)}`)
      console.log(`  Used:       ${formatUSDFC(serviceInfo.allowances.rateUsed)}`)
      console.log(
        `  Available:  ${formatUSDFC(serviceInfo.allowances.rateAllowance - serviceInfo.allowances.rateUsed)}`
      )
      console.log('\nLockup:')
      console.log(`  Allowance:  ${formatUSDFC(serviceInfo.allowances.lockupAllowance)}`)
      console.log(`  Used:       ${formatUSDFC(serviceInfo.allowances.lockupUsed)}`)
      console.log(
        `  Available:  ${formatUSDFC(serviceInfo.allowances.lockupAllowance - serviceInfo.allowances.lockupUsed)}`
      )
    } else {
      console.log('No allowances found (wallet may not be connected or no approvals set)')
    }

    // Get client's data sets
    console.log('\n--- Your Data Sets ---')
    try {
      // Create WarmStorage service to check data sets
      const provider = synapse.getProvider()
      const warmStorageAddress = synapse.getWarmStorageAddress()
      const warmStorageService = await WarmStorageService.create(provider, warmStorageAddress)
      const dataSets = await warmStorageService.getClientDataSets(address)

      if (dataSets.length === 0) {
        console.log('No data sets found for your wallet')
      } else {
        console.log(`Total data sets: ${dataSets.length}`)
        for (const [index, dataSet] of dataSets.entries()) {
          console.log(`\nData Set ${index + 1}:`)
          console.log(`  Client Dataset ID: ${dataSet.clientDataSetId}`)
          console.log(`  Provider ID:       ${dataSet.providerId}`)
          console.log(`  Payment End Epoch: ${dataSet.paymentEndEpoch}`)

          // Try to get provider info for this data set
          try {
            const provider = await synapse.getProviderInfo(dataSet.providerId)
            console.log(`  Provider Name:     ${provider.name}`)
            if (provider.products.PDP?.data.serviceURL) {
              console.log(`  Service URL:       ${provider.products.PDP.data.serviceURL}`)
            }
          } catch {
            console.log(`  Provider:          #${dataSet.providerId} (details unavailable)`)
          }
        }
      }
    } catch (error) {
      console.log('Could not fetch data sets:', error.message)
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
