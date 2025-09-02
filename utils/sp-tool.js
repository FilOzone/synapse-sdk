#!/usr/bin/env node

/**
 * SP Registry CLI Tool
 *
 * A simple command-line tool for managing service provider registrations
 * in the Synapse SP Registry contract.
 *
 * Usage: node utils/sp-tool.js <command> [options]
 */

import { ethers } from 'ethers'
import { SPRegistryService } from '../dist/sp-registry/index.js'
import { CONTRACT_ADDRESSES } from '../dist/utils/constants.js'
import { getFilecoinNetworkType } from '../dist/utils/network.js'
import { WarmStorageService } from '../dist/warm-storage/index.js'

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const command = args[0]
  const options = {}

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2)
      const value = args[i + 1]
      if (value && !value.startsWith('--')) {
        options[key] = value
        i++
      } else {
        options[key] = true
      }
    }
  }

  return { command, options }
}

// Get or create SPRegistryService instance
async function getRegistryService(provider, options) {
  // Priority 1: Direct registry address
  if (options.registry) {
    console.log(`Using registry address: ${options.registry}`)
    return new SPRegistryService(provider, options.registry)
  }

  // Priority 2: Discover from warm storage
  let warmStorageAddress = options.warm

  // Priority 3: Use default warm storage
  if (warmStorageAddress) {
    console.log(`Using WarmStorage: ${warmStorageAddress}`)
  } else {
    const networkName = await getFilecoinNetworkType(provider)
    warmStorageAddress = CONTRACT_ADDRESSES.WARM_STORAGE[networkName]
    console.log(`Using default WarmStorage for ${networkName}: ${warmStorageAddress}`)
  }

  // Create WarmStorageService and discover registry
  const warmStorage = await WarmStorageService.create(provider, warmStorageAddress)
  const registryAddress = warmStorage.getServiceProviderRegistryAddress()
  console.log(`Discovered registry: ${registryAddress}`)

  return new SPRegistryService(provider, registryAddress)
}

// Format provider info for display
function formatProvider(provider) {
  const product = provider.products?.PDP
  const price = product?.data?.storagePricePerTibPerMonth
    ? (Number(product.data.storagePricePerTibPerMonth) / 1000000).toFixed(2)
    : 'N/A'
  const serviceURL = product?.data?.serviceURL || 'Not configured'
  return `
Provider #${provider.id}:
  Name: ${provider.name}
  Description: ${provider.description}
  Address: ${provider.address}
  HTTP Endpoint: ${serviceURL}
  Active: ${provider.active}
  PDP Service: ${product?.isActive ? `Active (${price} USDFC/TiB/month)` : 'Not configured'}
`
}

// WarmStorage command handlers
async function handleWarmAdd(provider, signer, options) {
  if (!options.id) {
    console.error('Error: --id is required for adding to WarmStorage')
    process.exit(1)
  }

  const warmStorageAddress = options.warm || CONTRACT_ADDRESSES.WARM_STORAGE[await getFilecoinNetworkType(provider)]

  console.log(`Using WarmStorage: ${warmStorageAddress}`)
  const warmStorage = await WarmStorageService.create(provider, warmStorageAddress)

  // Get current approved providers
  const currentProviders = await warmStorage.getApprovedProviderIds()
  if (currentProviders.includes(Number(options.id))) {
    console.log(`Provider #${options.id} is already approved`)
    return
  }

  console.log(`\nAdding provider #${options.id} to WarmStorage approved list...`)

  try {
    const tx = await warmStorage.addApprovedProvider(signer, Number(options.id))
    console.log(`Transaction sent: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`)
    console.log(`\nProvider #${options.id} added to WarmStorage approved list`)
  } catch (error) {
    console.error(`\nError adding provider: ${error.message}`)
    process.exit(1)
  }
}

async function handleWarmRemove(provider, signer, options) {
  if (!options.id) {
    console.error('Error: --id is required for removing from WarmStorage')
    process.exit(1)
  }

  const warmStorageAddress = options.warm || CONTRACT_ADDRESSES.WARM_STORAGE[await getFilecoinNetworkType(provider)]

  console.log(`Using WarmStorage: ${warmStorageAddress}`)
  const warmStorage = await WarmStorageService.create(provider, warmStorageAddress)

  console.log(`\nRemoving provider #${options.id} from WarmStorage approved list...`)

  try {
    const tx = await warmStorage.removeApprovedProvider(signer, Number(options.id))
    console.log(`Transaction sent: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`)
    console.log(`\nProvider #${options.id} removed from WarmStorage approved list`)
  } catch (error) {
    console.error(`\nError removing provider: ${error.message}`)
    // Try to get more details about the error
    if (error.reason) {
      console.error(`Reason: ${error.reason}`)
    }
    if (error.data) {
      console.error(`Error data: ${error.data}`)
    }
    process.exit(1)
  }
}

async function handleWarmList(provider, options) {
  const warmStorageAddress = options.warm || CONTRACT_ADDRESSES.WARM_STORAGE[await getFilecoinNetworkType(provider)]

  console.log(`Using WarmStorage: ${warmStorageAddress}`)
  const warmStorage = await WarmStorageService.create(provider, warmStorageAddress)

  console.log('\nFetching WarmStorage approved providers...\n')

  try {
    const approvedIds = await warmStorage.getApprovedProviderIds()

    if (approvedIds.length === 0) {
      console.log('No approved providers in WarmStorage')
      return
    }

    console.log(`Found ${approvedIds.length} approved provider(s) in WarmStorage:`)
    console.log(`Provider IDs: ${approvedIds.join(', ')}\n`)

    // Get details for each provider from registry
    const registry = await getRegistryService(provider, options)
    for (const id of approvedIds) {
      const providerInfo = await registry.getProvider(id)
      if (providerInfo) {
        console.log(formatProvider(providerInfo))
      } else {
        console.log(`Provider #${id}: Not found in registry (may have been removed)\n`)
      }
    }
  } catch (error) {
    console.error(`\nError listing providers: ${error.message}`)
    process.exit(1)
  }
}

// Command handlers
async function handleRegister(provider, signer, options) {
  if (!options.name || !options.http) {
    console.error('Error: --name and --http are required for registration')
    process.exit(1)
  }

  const registry = await getRegistryService(provider, options)
  const beneficiary = options.beneficiary || (await signer.getAddress())

  console.log(`\nRegistering provider:`)
  console.log(`  Name: ${options.name}`)
  console.log(`  HTTP: ${options.http}`)
  console.log(`  Beneficiary: ${beneficiary}`)
  console.log(`  Description: ${options.description || '(none)'}`)
  console.log(`  Registration Fee: 5 FIL`)

  try {
    // Use the SDK's registerProvider method which already handles the contract details
    // Note: registerProvider in SDK doesn't handle the fee, we need to do it ourselves
    const contract = registry._getRegistryContract().connect(signer)
    const registrationFee = await contract.REGISTRATION_FEE()

    // Encode PDP offering
    const encodedOffering = await registry.encodePDPOffering({
      serviceURL: options.http,
      minPieceSizeInBytes: BigInt(1024), // 1 KiB minimum
      maxPieceSizeInBytes: BigInt(32) * BigInt(1024) * BigInt(1024) * BigInt(1024), // 32 GiB maximum
      ipniPiece: false, // Not using IPNI for piece discovery
      ipniIpfs: false, // Not using IPNI for IPFS content
      storagePricePerTibPerMonth: BigInt(1000000), // 1 USDFC per TiB per month
      minProvingPeriodInEpochs: 30, // 30 epochs (15 minutes on calibnet)
      location: options.location || 'unknown',
      paymentTokenAddress: '0x0000000000000000000000000000000000000000', // Native token
    })

    // Prepare capability arrays
    const capabilityKeys = options.location ? ['location'] : []
    const capabilityValues = options.location ? [options.location] : []

    // Call registerProvider with value
    const tx = await contract.registerProvider(
      options.name,
      options.description || '',
      0, // ProductType.PDP
      encodedOffering,
      capabilityKeys,
      capabilityValues,
      { value: registrationFee }
    )

    console.log(`\nTransaction sent: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`)

    // Extract provider ID from events
    const event = receipt.logs.find((log) => log.topics[0] === ethers.id('ProviderRegistered(uint256,address)'))
    if (event) {
      const providerId = parseInt(event.topics[1], 16)
      console.log(`\nProvider registered with ID: ${providerId}`)
    }
  } catch (error) {
    console.error(`\nError registering provider: ${error.message}`)
    process.exit(1)
  }
}

async function handleUpdate(provider, signer, options) {
  if (!options.id) {
    console.error('Error: --id is required for update')
    process.exit(1)
  }

  const registry = await getRegistryService(provider, options)

  // Get current provider info
  const current = await registry.getProvider(Number(options.id))
  if (!current) {
    console.error(`Provider #${options.id} not found`)
    process.exit(1)
  }

  const name = options.name || current.name
  const description = options.description || current.description

  console.log(`\nUpdating provider #${options.id}:`)
  console.log(`  Name: ${current.name} → ${name}`)
  console.log(`  Description: ${current.description} → ${description}`)

  try {
    const tx = await registry.updateProviderInfo(signer, name, description)
    console.log(`\nTransaction sent: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`)
    console.log(`\nProvider #${options.id} updated successfully`)
  } catch (error) {
    console.error(`\nError updating provider: ${error.message}`)
    process.exit(1)
  }
}

async function handleDeregister(provider, signer, options) {
  if (!options.id) {
    console.error('Error: --id is required for deregistration')
    process.exit(1)
  }

  const registry = await getRegistryService(provider, options)

  console.log(`\nDeregistering provider #${options.id}...`)

  try {
    // Use the removeProvider method from SDK (provider removes themselves)
    const tx = await registry.removeProvider(signer)
    console.log(`Transaction sent: ${tx.hash}`)
    const receipt = await tx.wait()
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`)
    console.log(`\nProvider #${options.id} deregistered successfully`)
  } catch (error) {
    console.error(`\nError deregistering provider: ${error.message}`)
    process.exit(1)
  }
}

async function handleInfo(provider, options) {
  if (!options.id && !options.address) {
    console.error('Error: --id or --address is required for info')
    process.exit(1)
  }

  const registry = await getRegistryService(provider, options)

  try {
    let providerInfo

    if (options.address) {
      providerInfo = await registry.getProviderByAddress(options.address)
      if (!providerInfo) {
        console.log(`\nNo provider found for address: ${options.address}`)
        return
      }
    } else {
      providerInfo = await registry.getProvider(Number(options.id))
      if (!providerInfo) {
        console.log(`\nProvider #${options.id} not found`)
        return
      }
    }

    console.log(formatProvider(providerInfo))
  } catch (error) {
    console.error(`\nError getting provider info: ${error.message}`)
    process.exit(1)
  }
}

async function handleList(provider, options) {
  const registry = await getRegistryService(provider, options)

  console.log('\nFetching all active providers...\n')

  try {
    const providers = await registry.getAllActiveProviders()

    if (providers.length === 0) {
      console.log('No active providers found')
    } else {
      console.log(`Found ${providers.length} active provider(s):\n`)
      for (const providerInfo of providers) {
        console.log(formatProvider(providerInfo))
      }
    }
  } catch (error) {
    console.error(`\nError listing providers: ${error.message}`)
    process.exit(1)
  }
}

// Main execution
async function main() {
  const { command, options } = parseArgs()

  if (!command || command === 'help') {
    console.log(`
SP Registry CLI Tool

Usage: node utils/sp-tool.js <command> [options]

Registry Commands:
  register    Register a new service provider
  update      Update existing provider details
  deregister  Deregister a provider
  info        Get provider information
  list        List all active providers

WarmStorage Commands:
  warm-add    Add provider to WarmStorage approved list
  warm-remove Remove provider from WarmStorage approved list
  warm-list   List WarmStorage approved providers

Options:
  --rpc-url <url>       RPC endpoint (default: calibration)
  --key <private-key>   Private key for signing (required for write operations)
  --registry <address>  Registry contract address (overrides discovery)
  --warm <address>      WarmStorage address (for registry discovery or warm commands)
  --id <provider-id>    Provider ID
  --address <address>   Provider address (for info command)
  --name <name>         Provider name (for register/update)
  --http <url>          HTTP endpoint URL (for register only)
  --beneficiary <addr>  Payment beneficiary address
  --description <text>  Provider description (for register/update)
  --location <text>     Provider location (e.g., "us-east")

Examples:
  # Register a new provider (requires 5 FIL fee)
  node utils/sp-tool.js register --key 0x... --name "My Provider" --http "https://provider.example.com"
  
  # Add provider to WarmStorage approved list
  node utils/sp-tool.js warm-add --key 0x... --id 2
  
  # List WarmStorage approved providers
  node utils/sp-tool.js warm-list
  
  # Remove provider from WarmStorage
  node utils/sp-tool.js warm-remove --key 0x... --id 2
`)
    process.exit(0)
  }

  // Setup provider
  const rpcUrl = options['rpc-url'] || 'https://api.calibration.node.glif.io/rpc/v1'
  const provider = new ethers.JsonRpcProvider(rpcUrl)

  // Setup signer if needed
  let signer = null
  if (['register', 'update', 'deregister', 'warm-add', 'warm-remove'].includes(command)) {
    if (!options.key) {
      console.error('Error: --key is required for write operations')
      process.exit(1)
    }
    signer = new ethers.Wallet(options.key, provider)
    console.log(`Using signer address: ${await signer.getAddress()}`)
  }

  // Execute command
  switch (command) {
    case 'register':
      await handleRegister(provider, signer, options)
      break
    case 'update':
      await handleUpdate(provider, signer, options)
      break
    case 'deregister':
      await handleDeregister(provider, signer, options)
      break
    case 'info':
      await handleInfo(provider, options)
      break
    case 'list':
      await handleList(provider, options)
      break
    case 'warm-add':
      await handleWarmAdd(provider, signer, options)
      break
    case 'warm-remove':
      await handleWarmRemove(provider, signer, options)
      break
    case 'warm-list':
      await handleWarmList(provider, options)
      break
    default:
      console.error(`Unknown command: ${command}`)
      console.log('Run "node utils/sp-tool.js help" for usage information')
      process.exit(1)
  }
}

// Run the tool
main().catch((error) => {
  console.error(`\nFatal error: ${error.message}`)
  process.exit(1)
})
