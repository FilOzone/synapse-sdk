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
import { SPRegistryService } from '../packages/synapse-sdk/src/sp-registry/index.ts'
import { CONTRACT_ADDRESSES, RPC_URLS } from '../packages/synapse-sdk/src/utils/constants.ts'
import { getFilecoinNetworkType } from '../packages/synapse-sdk/src/utils/network.ts'
import { WarmStorageService } from '../packages/synapse-sdk/src/warm-storage/index.ts'

// Default PDP offering values
const PDP_DEFAULTS = {
  MIN_PIECE_SIZE: 127n,
  MAX_PIECE_SIZE: (32n * 1024n ** 3n * 126n) / 127n, // ~32 GiB adjusted for fr32 padding (127/126 expansion)
  IPNI_PIECE: true,
  IPNI_IPFS: true,
  STORAGE_PRICE_PER_TIB_PER_MONTH: 5000000000000000000n, // 5 USDFC (18 decimals)
  MIN_PROVING_PERIOD_EPOCHS: 30, // 30 epochs (15 minutes on calibnet)
  LOCATION: '',
  // PAYMENT_TOKEN_ADDRESS resolved dynamically from CONTRACT_ADDRESSES.USDFC[network]
}

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
        // Handle repeated --capability flags by collecting them in an array
        if (key === 'capability') {
          if (!options.capability) {
            options.capability = []
          }
          options.capability.push(value)
        } else {
          options[key] = value
        }
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

// Validate Distinguished Name (DN) format for location
function validateDNLocation(location) {
  if (!location) {
    return true // Optional field
  }

  // Split by semicolon
  const parts = location.split(';')
  const dnMap = new Map()
  const allowedKeys = new Set(['C', 'ST', 'L'])

  for (const part of parts) {
    // Split each token by =
    const tokens = part.split('=')

    // Must yield exactly 2 non-zero length strings
    if (tokens.length !== 2 || tokens[0].length === 0 || tokens[1].length === 0) {
      console.error(
        `Error: Invalid DN format for --location. Each component must be in key=value format.\nExample: "C=US;ST=California;L=San Francisco"`
      )
      process.exit(1)
    }

    const key = tokens[0]
    const value = tokens[1]

    // Reject leading or trailing spaces on keys or values
    if (key !== key.trim() || value !== value.trim()) {
      console.error(
        `Error: --location keys and values must not have leading or trailing spaces.\nFound: "${part}"\nExample: "C=US;ST=California;L=San Francisco"`
      )
      process.exit(1)
    }

    // Check for allowed keys (case sensitive)
    if (!allowedKeys.has(key)) {
      console.error(
        `Error: Invalid DN key "${key}" in --location. Only C (country), ST (state/province), and L (locality) are allowed.\nExample: "C=US;ST=California;L=San Francisco"`
      )
      process.exit(1)
    }

    // Check for duplicates
    if (dnMap.has(key)) {
      console.error(`Error: Duplicate key "${key}" in --location. Each key can only appear once.`)
      process.exit(1)
    }

    dnMap.set(key, value)
  }

  // Require C= (country)
  if (!dnMap.has('C')) {
    console.error(
      `Error: --location must include C= (country) component.\nExample: "C=US;ST=California;L=San Francisco"`
    )
    process.exit(1)
  }

  return true
}

// Normalize capability option to array
function normalizeCapabilities(capabilityOption) {
  return Array.isArray(capabilityOption) ? capabilityOption : capabilityOption ? [capabilityOption] : []
}

// Validate PDP input parameters
function validatePDPInputs(options) {
  // Validate service URL format
  if (options['service-url']) {
    try {
      const url = new URL(options['service-url'])
      if (!['http:', 'https:'].includes(url.protocol)) {
        console.error('Error: --service-url must use HTTP or HTTPS protocol')
        process.exit(1)
      }
      // Warn about HTTP for production networks
      if (url.protocol === 'http:') {
        console.warn('Warning: HTTP URLs are acceptable for testing only. Use HTTPS for calibnet/mainnet.')
      }
    } catch {
      console.error('Error: --service-url must be a valid URL')
      process.exit(1)
    }
  }

  // Validate numeric inputs
  if (options.price) {
    try {
      const price = BigInt(options.price)
      if (price < 0n) {
        console.error('Error: --price must be a positive number')
        process.exit(1)
      }
    } catch {
      console.error('Error: --price must be a valid number (in USDFC base units)')
      process.exit(1)
    }
  }

  if (options['min-piece-size']) {
    const minSize = Number(options['min-piece-size'])
    if (!Number.isInteger(minSize) || minSize <= 0) {
      console.error('Error: --min-piece-size must be a positive integer')
      process.exit(1)
    }
  }

  if (options['max-piece-size']) {
    const maxSize = Number(options['max-piece-size'])
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      console.error('Error: --max-piece-size must be a positive integer')
      process.exit(1)
    }
  }

  if (options['min-proving-period']) {
    const period = Number(options['min-proving-period'])
    if (!Number.isInteger(period) || period <= 0) {
      console.error('Error: --min-proving-period must be a positive integer')
      process.exit(1)
    }
  }

  // Validate boolean inputs
  if (options['ipni-piece'] !== undefined && !['true', 'false'].includes(options['ipni-piece'])) {
    console.error('Error: --ipni-piece must be "true" or "false"')
    process.exit(1)
  }

  if (options['ipni-ipfs'] !== undefined && !['true', 'false'].includes(options['ipni-ipfs'])) {
    console.error('Error: --ipni-ipfs must be "true" or "false"')
    process.exit(1)
  }

  // Validate payment token address format (basic check)
  if (options['payment-token']) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(options['payment-token'])) {
      console.error('Error: --payment-token must be a valid Ethereum address (0x followed by 40 hex characters)')
      process.exit(1)
    }
  }

  // Validate location format (Distinguished Name)
  if (options.location) {
    validateDNLocation(options.location)
  }

  // Validate capability format (key=value, value can be empty string)
  if (options.capability) {
    const capabilities = normalizeCapabilities(options.capability)
    for (const cap of capabilities) {
      const tokens = cap.split('=')
      if (tokens.length !== 2 || tokens[0].length === 0) {
        console.error(`Error: --capability must be in key=value format. Got: "${cap}"`)
        process.exit(1)
      }
      // Check for leading/trailing spaces (only check key if value is non-empty)
      if (tokens[0] !== tokens[0].trim()) {
        console.error(`Error: --capability keys must not have leading or trailing spaces.\nFound: "${cap}"`)
        process.exit(1)
      }
      if (tokens[1].length > 0 && tokens[1] !== tokens[1].trim()) {
        console.error(`Error: --capability values must not have leading or trailing spaces.\nFound: "${cap}"`)
        process.exit(1)
      }
    }
  }
}

// Format provider info for display
function formatProvider(provider) {
  const product = provider.products?.PDP
  const pdpOffering = product?.data

  let output = `
Provider #${provider.id}:
  Name: ${provider.name}
  Description: ${provider.description}
  Service Provider: ${provider.serviceProvider}
  Payee: ${provider.payee}
  Active: ${provider.active}
`

  if (product?.isActive && pdpOffering) {
    const price = ethers.formatUnits(pdpOffering.storagePricePerTibPerMonth, 18)
    const minSize = pdpOffering.minPieceSizeInBytes.toString()
    const maxSize = pdpOffering.maxPieceSizeInBytes.toString()

    output += `
  PDP Service: Active
    Service URL: ${pdpOffering.serviceURL}
    Location: ${pdpOffering.location || '(not set)'}
    Price: ${price} USDFC/TiB/month
    Piece Size Range: ${minSize} - ${maxSize} bytes
    IPNI Piece Discovery: ${pdpOffering.ipniPiece}
    IPNI IPFS Indexing: ${pdpOffering.ipniIpfs}
    Min Proving Period: ${pdpOffering.minProvingPeriodInEpochs} epochs
    Payment Token: ${pdpOffering.paymentTokenAddress}
`

    // Display capabilities if any
    const capabilities = product.capabilities || {}
    const capabilityKeys = Object.keys(capabilities)
    if (capabilityKeys.length > 0) {
      output += `    Capabilities:\n`
      for (const key of capabilityKeys) {
        output += `      ${key}: ${capabilities[key]}\n`
      }
    }
  } else {
    output += `  PDP Service: Not configured\n`
  }

  return output
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
  const payee = options.payee || (await signer.getAddress())

  console.log(`\nRegistering provider:`)
  console.log(`  Name: ${options.name}`)
  console.log(`  HTTP: ${options.http}`)
  console.log(`  Payee: ${payee}`)
  console.log(`  Description: ${options.description || '(none)'}`)
  console.log(`  Registration Fee: 5 FIL`)

  try {
    // Use the SDK's registerProvider method which already handles the contract details
    // Note: registerProvider in SDK doesn't handle the fee, we need to do it ourselves
    const contract = registry._getRegistryContract().connect(signer)
    const registrationFee = await contract.REGISTRATION_FEE()

    // Get network-specific USDFC address
    const network = await getFilecoinNetworkType(provider)
    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[network]

    // Encode PDP offering
    const encodedOffering = await registry.encodePDPOffering({
      serviceURL: options.http,
      minPieceSizeInBytes: PDP_DEFAULTS.MIN_PIECE_SIZE,
      maxPieceSizeInBytes: PDP_DEFAULTS.MAX_PIECE_SIZE,
      ipniPiece: PDP_DEFAULTS.IPNI_PIECE,
      ipniIpfs: PDP_DEFAULTS.IPNI_IPFS,
      storagePricePerTibPerMonth: PDP_DEFAULTS.STORAGE_PRICE_PER_TIB_PER_MONTH,
      minProvingPeriodInEpochs: PDP_DEFAULTS.MIN_PROVING_PERIOD_EPOCHS,
      location: options.location || PDP_DEFAULTS.LOCATION,
      paymentTokenAddress: options['payment-token'] || usdfcAddress,
    })

    // Prepare capability arrays from --capability flags
    const capabilities = normalizeCapabilities(options.capability)
    const capabilityKeys = []
    const capabilityValues = []
    for (const cap of capabilities) {
      const [key, value] = cap.split('=')
      capabilityKeys.push(key)
      capabilityValues.push(value)
    }

    // Call registerProvider with value
    const tx = await contract.registerProvider(
      payee,
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
    const event = receipt.logs.find((log) => log.topics[0] === ethers.id('ProviderRegistered(uint256,address,address)'))
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
  const registry = await getRegistryService(provider, options)
  const signerAddress = await signer.getAddress()

  // If --id is provided, validate that the signer owns this provider
  if (options.id) {
    const specifiedProvider = await registry.getProvider(Number(options.id))
    if (!specifiedProvider) {
      console.error(`Provider #${options.id} not found`)
      process.exit(1)
    }

    if (specifiedProvider.serviceProvider.toLowerCase() !== signerAddress.toLowerCase()) {
      console.error(
        `Error: Provider #${options.id} is owned by ${specifiedProvider.serviceProvider}, but you are using signer ${signerAddress}`
      )
      console.error(`\nYou can only update providers you own. Either:`)
      console.error(`  1. Use the correct private key for provider #${options.id}`)
      console.error(`  2. Omit --id to update your own provider`)
      process.exit(1)
    }
  }

  // Get the provider owned by this signer
  const current = await registry.getProviderByAddress(signerAddress)
  if (!current) {
    console.error(`Error: No provider registered for signer address ${signerAddress}`)
    if (options.id) {
      console.error(`\nNote: --id ${options.id} cannot be updated because it's owned by a different address`)
    }
    console.error(`\nTo register a new provider, use: node utils/sp-tool.js register --help`)
    process.exit(1)
  }

  // Determine which type of updates to perform
  const hasBasicUpdates = options.name || options.description
  const hasPDPUpdates =
    options.location ||
    options.price ||
    options['service-url'] ||
    options['min-piece-size'] ||
    options['max-piece-size'] ||
    options['ipni-piece'] !== undefined ||
    options['ipni-ipfs'] !== undefined ||
    options['min-proving-period'] ||
    options['payment-token'] ||
    options.capability

  if (!hasBasicUpdates && !hasPDPUpdates) {
    console.error('Error: No update parameters provided. Use --name, --description, or PDP offering options.')
    process.exit(1)
  }

  console.log(`\nUpdating provider #${options.id}:`)

  try {
    // Handle basic provider info updates
    if (hasBasicUpdates) {
      const name = options.name || current.name
      const description = options.description || current.description

      console.log(`  Name: ${current.name} → ${name}`)
      console.log(`  Description: ${current.description} → ${description}`)

      const basicTx = await registry.updateProviderInfo(signer, name, description)
      console.log(`\nBasic info transaction sent: ${basicTx.hash}`)
      const basicReceipt = await basicTx.wait()
      console.log(`Basic info transaction confirmed in block ${basicReceipt.blockNumber}`)
    }

    // Handle PDP offering updates
    if (hasPDPUpdates) {
      await handlePDPUpdate(registry, signer, options, provider)
    }

    console.log(`\nProvider #${options.id} updated successfully`)
  } catch (error) {
    console.error(`\nError updating provider: ${error.message}`)
    process.exit(1)
  }
}

async function handlePDPUpdate(registry, signer, options, provider) {
  const providerId = Number(options.id)

  // Get current PDP offering
  const currentPDP = await registry.getPDPService(providerId)

  if (!currentPDP && !options['service-url']) {
    console.error('Error: Provider does not have an existing PDP offering. --service-url is required to create one.')
    process.exit(1)
  }

  // Validate inputs before processing
  validatePDPInputs(options)

  // Get network-specific USDFC address
  const network = await getFilecoinNetworkType(provider)
  const usdfcAddress = CONTRACT_ADDRESSES.USDFC[network]

  // Prepare updated PDP offering by merging current values with new ones
  const updatedOffering = {
    serviceURL: options['service-url'] || currentPDP?.offering.serviceURL || '',
    minPieceSizeInBytes: options['min-piece-size']
      ? BigInt(options['min-piece-size'])
      : currentPDP?.offering.minPieceSizeInBytes || PDP_DEFAULTS.MIN_PIECE_SIZE,
    maxPieceSizeInBytes: options['max-piece-size']
      ? BigInt(options['max-piece-size'])
      : currentPDP?.offering.maxPieceSizeInBytes || PDP_DEFAULTS.MAX_PIECE_SIZE,
    ipniPiece:
      options['ipni-piece'] !== undefined
        ? options['ipni-piece'] === 'true'
        : currentPDP?.offering.ipniPiece || PDP_DEFAULTS.IPNI_PIECE,
    ipniIpfs:
      options['ipni-ipfs'] !== undefined
        ? options['ipni-ipfs'] === 'true'
        : currentPDP?.offering.ipniIpfs || PDP_DEFAULTS.IPNI_IPFS,
    storagePricePerTibPerMonth: options.price
      ? BigInt(options.price)
      : currentPDP?.offering.storagePricePerTibPerMonth || PDP_DEFAULTS.STORAGE_PRICE_PER_TIB_PER_MONTH,
    minProvingPeriodInEpochs: options['min-proving-period']
      ? Number(options['min-proving-period'])
      : currentPDP?.offering.minProvingPeriodInEpochs || PDP_DEFAULTS.MIN_PROVING_PERIOD_EPOCHS,
    location: options.location || currentPDP?.offering.location || PDP_DEFAULTS.LOCATION,
    paymentTokenAddress: options['payment-token'] || currentPDP?.offering.paymentTokenAddress || usdfcAddress,
  }

  // Validate piece size constraints
  if (updatedOffering.minPieceSizeInBytes >= updatedOffering.maxPieceSizeInBytes) {
    console.error('Error: min-piece-size must be smaller than max-piece-size')
    process.exit(1)
  }

  // Prepare capabilities from --capability flags (preserve existing ones)
  const capabilities = { ...(currentPDP?.capabilities || {}) }
  const capabilityList = normalizeCapabilities(options.capability)
  for (const cap of capabilityList) {
    const [key, value] = cap.split('=')
    capabilities[key] = value
  }

  // Validate required fields
  if (!updatedOffering.serviceURL) {
    console.error('Error: serviceURL is required for PDP offering')
    process.exit(1)
  }

  // Display what's being updated
  console.log('\n  PDP Service Offering Updates:')
  if (options['service-url'])
    console.log(`    Service URL: ${currentPDP?.offering.serviceURL || 'none'} → ${updatedOffering.serviceURL}`)
  if (options.location)
    console.log(`    Location: ${currentPDP?.offering.location || 'none'} → ${updatedOffering.location}`)
  if (options.price)
    console.log(
      `    Price: ${currentPDP?.offering.storagePricePerTibPerMonth || 'none'} → ${updatedOffering.storagePricePerTibPerMonth} USDFC base units/TiB/month`
    )
  if (options['min-piece-size'])
    console.log(
      `    Min Piece Size: ${currentPDP?.offering.minPieceSizeInBytes || 'none'} → ${updatedOffering.minPieceSizeInBytes} bytes`
    )
  if (options['max-piece-size'])
    console.log(
      `    Max Piece Size: ${currentPDP?.offering.maxPieceSizeInBytes || 'none'} → ${updatedOffering.maxPieceSizeInBytes} bytes`
    )
  if (options['ipni-piece'] !== undefined)
    console.log(`    IPNI Piece: ${currentPDP?.offering.ipniPiece || false} → ${updatedOffering.ipniPiece}`)
  if (options['ipni-ipfs'] !== undefined)
    console.log(`    IPNI IPFS: ${currentPDP?.offering.ipniIpfs || false} → ${updatedOffering.ipniIpfs}`)
  if (options['min-proving-period'])
    console.log(
      `    Min Proving Period: ${currentPDP?.offering.minProvingPeriodInEpochs || 'none'} → ${updatedOffering.minProvingPeriodInEpochs} epochs`
    )
  if (options['payment-token'])
    console.log(
      `    Payment Token: ${currentPDP?.offering.paymentTokenAddress || 'none'} → ${updatedOffering.paymentTokenAddress}`
    )

  // Update PDP offering
  const pdpTx = await registry.updatePDPProduct(signer, updatedOffering, capabilities)
  console.log(`\nPDP offering transaction sent: ${pdpTx.hash}`)
  const pdpReceipt = await pdpTx.wait()
  console.log(`PDP offering transaction confirmed in block ${pdpReceipt.blockNumber}`)
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
  update      Update your provider's details (requires --key for provider owner)
  deregister  Deregister a provider
  info        Get provider information
  list        List all active providers

WarmStorage Commands:
  warm-add    Add provider to WarmStorage approved list
  warm-remove Remove provider from WarmStorage approved list
  warm-list   List WarmStorage approved providers

Options:
  --network <network>       Network to use: 'mainnet' or 'calibration' (default: calibration)
  --rpc-url <url>           RPC endpoint (overrides network default)
  --key <private-key>       Private key for signing (required for write operations)
  --registry <address>      Registry contract address (overrides discovery)
  --warm <address>          WarmStorage address (for registry discovery or warm commands)
  --id <provider-id>        Provider ID
  --address <address>       Provider address (for info command)

Provider Info Options (register/update):
  --name <name>             Provider name
  --description <text>      Provider description
  --payee <addr>            Payment recipient address (register only)

PDP Service Options (register/update):
  --http <url>              HTTP endpoint URL (alias for --service-url, register only)
  --service-url <url>       PDP service endpoint URL
  --location <text>         Provider location in DN format (e.g., "C=US;ST=California;L=San Francisco")
  --price <amount>          Storage price per TiB per month in USDFC base units (18 decimals)
                            Example: "5000000000000000000" = 5 USDFC per TiB per month
  --min-piece-size <bytes>  Minimum piece size in bytes (default: 127)
  --max-piece-size <bytes>  Maximum piece size in bytes (default: ~32 GiB fr32-adjusted)
  --ipni-piece <bool>       Enable IPNI piece discovery (true/false, default: true)
  --ipni-ipfs <bool>        Enable IPNI IPFS content (true/false, default: true)
  --min-proving-period <n>  Minimum proving period in epochs (default: 30)
  --payment-token <addr>    Payment token address (default: USDFC)
  --capability <key=value>  Add arbitrary capability (value can be empty string, can be repeated for multiples)

Examples:
  # Register a new provider on mainnet (requires 5 FIL fee)
  node utils/sp-tool.js register --key 0x... --name "My Provider" --http "https://provider.example.com" --network mainnet

  # Register a new provider on calibration (default network)
  node utils/sp-tool.js register --key 0x... --name "My Provider" --http "https://provider.example.com" --payee 0x...

  # Update basic provider information (updates your provider)
  node utils/sp-tool.js update --key 0x... --name "Updated Provider Name" --description "New description"

  # Update PDP service offering location
  node utils/sp-tool.js update --key 0x... --location "C=US;ST=California;L=San Francisco"

  # Update PDP service pricing and location (5 USDFC per TiB per month)
  node utils/sp-tool.js update --key 0x... --location "C=GB;ST=England;L=London" --price "5000000000000000000"

  # Update PDP service endpoint and piece size limits
  node utils/sp-tool.js update --key 0x... --service-url "https://new-endpoint.example.com" --max-piece-size "68719476736"

  # Update capabilities (values can be empty strings)
  node utils/sp-tool.js update --key 0x... --capability "dev=" --capability "tier=premium"

  # Update with --id for validation (must be your provider)
  node utils/sp-tool.js update --key 0x... --id 123 --name "Updated Name" --location "C=JP;ST=Tokyo;L=Shibuya"

  # Register with custom capabilities (empty values are allowed for flags)
  node utils/sp-tool.js register --key 0x... --name "My Provider" --http "https://provider.example.com" --capability tier=premium --capability dev=

  # Add provider to WarmStorage approved list
  node utils/sp-tool.js warm-add --key 0x... --id 2

  # List WarmStorage approved providers
  node utils/sp-tool.js warm-list

  # Remove provider from WarmStorage
  node utils/sp-tool.js warm-remove --key 0x... --id 2
`)
    process.exit(0)
  }

  // Setup provider based on network flag
  const network = options.network || 'calibration'
  if (network !== 'mainnet' && network !== 'calibration') {
    console.error(`Error: Invalid network '${network}'. Must be 'mainnet' or 'calibration'`)
    process.exit(1)
  }

  // Use WebSocket URLs by default for better performance, fallback to HTTP if not available
  let defaultRpcUrl = RPC_URLS[network]?.websocket
  if (!defaultRpcUrl) {
    defaultRpcUrl = RPC_URLS[network]?.http
  }
  if (!options['rpc-url'] && !defaultRpcUrl) {
    console.error(`Error: No RPC URL available for network '${network}'. Please provide --rpc-url.`)
    process.exit(1)
  }
  const rpcUrl = options['rpc-url'] || defaultRpcUrl

  // Smart provider selection based on URL protocol
  let provider
  if (/^ws(s)?:\/\//i.test(rpcUrl)) {
    provider = new ethers.WebSocketProvider(rpcUrl)
  } else {
    provider = new ethers.JsonRpcProvider(rpcUrl)
  }

  // Validate the network matches what was requested
  const actualNetwork = await getFilecoinNetworkType(provider)
  if (actualNetwork !== network) {
    console.error(`Error: Provider connected to ${actualNetwork} network, but ${network} was requested`)
    process.exit(1)
  }

  // Print confirmed network
  console.log(`Connected to Filecoin ${actualNetwork} network`)

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
  try {
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
  } finally {
    // Clean up provider connection (important for WebSocket providers)
    if (provider && typeof provider.destroy === 'function') {
      try {
        // Suppress console errors during cleanup (nasty hack, but this appears to be an Ethers.js issue)
        const originalConsoleError = console.error
        console.error = () => {
          /* nothing to see here */
        }
        await provider.destroy()
        console.error = originalConsoleError
      } catch {
        // Ignore cleanup errors (e.g., WebSocket already closed, subscription cancellations)
        // These are harmless and expected during shutdown
      }
    }
  }
}

// Run the tool
main().catch((error) => {
  console.error(`\nFatal error: ${error.message}`)
  process.exit(1)
})
