#!/usr/bin/env node

/**
 * Post-Deployment Setup Script for Synapse - Client Payment Configuration
 *
 * This script primarily sets up client payment approvals for using Warm Storage.
 * For service provider operations, consider using utils/sp-tool.js instead.
 *
 * Main functions:
 * 1. Setting up client payment approvals (client mode - DEFAULT)
 * 2. Registering a service provider with ServiceProviderRegistry (provider mode)
 * 3. Adding a PDP product to the provider (provider mode)
 * 4. Approving the provider in WarmStorageService (provider mode)
 *
 * === DEPLOYMENT CONTEXT ===
 *
 * The system uses two contracts:
 * - ServiceProviderRegistry stores provider metadata and products
 * - WarmStorageService maintains approved provider IDs
 *
 * === USAGE ===
 *
 * ```bash
 * cd synapse-sdk
 *
 * # Setup client (default - most common use case)
 * CLIENT_PRIVATE_KEY=0x... \
 * node utils/post-deploy-setup.js
 *
 * # Setup only provider (consider using sp-tool.js instead)
 * DEPLOYER_PRIVATE_KEY=0x... \
 * SP_PRIVATE_KEY=0x... \
 * SP_SERVICE_URL=http://your-curio-node:4702 \
 * node utils/post-deploy-setup.js --mode provider
 *
 * # Setup both provider and client
 * DEPLOYER_PRIVATE_KEY=0x... \
 * SP_PRIVATE_KEY=0x... \
 * CLIENT_PRIVATE_KEY=0x... \
 * SP_SERVICE_URL=http://your-curio-node:4702 \
 * node utils/post-deploy-setup.js --mode both
 *
 * # With custom addresses:
 * DEPLOYER_PRIVATE_KEY=0x... \
 * SP_PRIVATE_KEY=0x... \
 * CLIENT_PRIVATE_KEY=0x... \
 * WARM_STORAGE_CONTRACT_ADDRESS=0x... \
 * SP_REGISTRY_ADDRESS=0x... \
 * SP_SERVICE_URL=http://your-curio-node:4702 \
 * node utils/post-deploy-setup.js
 * ```
 *
 * === EXECUTION MODES ===
 *
 * - client (default): Sets up client payment approvals - the most common use case
 * - provider: Sets up service provider registration and approval (consider sp-tool.js)
 * - both: Sets up both provider and client
 *
 * === REQUIRED ENVIRONMENT VARIABLES ===
 *
 * For mode "provider":
 * - DEPLOYER_PRIVATE_KEY: Private key of the Warm Storage contract deployer/owner
 * - SP_PRIVATE_KEY: Private key of the service provider
 * - SP_SERVICE_URL: Service provider's Curio HTTP endpoint
 *
 * For mode "client":
 * - CLIENT_PRIVATE_KEY: Private key of the client who will use storage
 *
 * For mode "both":
 * - All of the above
 *
 * === NOTE ON SERVICE PROVIDER OPERATIONS ===
 *
 * For dedicated service provider management, use utils/sp-tool.js which provides:
 * - Provider registration with the registry
 * - Adding/removing providers from WarmStorage approved list
 * - Updating provider information and products
 * - Listing approved providers
 *
 * === OPTIONAL ENVIRONMENT VARIABLES ===
 *
 * - WARM_STORAGE_CONTRACT_ADDRESS: Warm Storage address (defaults to address in constants.ts for network)
 * - SP_REGISTRY_ADDRESS: ServiceProviderRegistry address (auto-discovered from WarmStorage if not provided)
 * - NETWORK: Either 'mainnet' or 'calibration' (default: calibration)
 * - RPC_URL: Custom RPC endpoint (overrides default network RPC)
 * - SP_NAME: Provider name (default: "Test Service Provider")
 * - SP_DESCRIPTION: Provider description (default: "Test provider for Warm Storage")
 * - MIN_PIECE_SIZE: Minimum piece size in bytes (default: 128)
 * - MAX_PIECE_SIZE: Maximum piece size in bytes (default: 34091302912 - 32GiB minus fr32 padding)
 * - STORAGE_PRICE_PER_TIB_PER_MONTH: Price in smallest USDFC unit (default: 5000000000000000000 - 5 USDFC)
 * - MIN_PROVING_PERIOD: Minimum proving period in epochs (default: 2880)
 * - LOCATION: Provider location in X.509 DN format (default: "/C=AU/ST=NSW", example: "/C=US/ST=California/L=San Francisco")
 */

import { ethers } from 'ethers'
import { PaymentsService } from '../dist/payments/service.js'
import { SPRegistryService } from '../dist/sp-registry/service.js'
import { CONTRACT_ADDRESSES, RPC_URLS, TOKENS } from '../dist/utils/constants.js'
import { WarmStorageService } from '../dist/warm-storage/service.js'

// Constants for payment approvals
const RATE_ALLOWANCE_PER_EPOCH = ethers.parseUnits('0.1', 18) // 0.1 USDFC per epoch
const LOCKUP_ALLOWANCE = ethers.parseUnits('10', 18) // 10 USDFC lockup allowance
const MAX_LOCKUP_PERIOD = 86400n // 30 days in epochs (30 * 2880 epochs/day)
const INITIAL_DEPOSIT_AMOUNT = ethers.parseUnits('1', 18) // 1 USDFC initial deposit

// Default PDP configuration values
const DEFAULT_STORAGE_PRICE = 5000000000000000000n // 5 USDFC per TiB per month (with 18 decimals)
const DEFAULT_MIN_PIECE_SIZE = 128n // 128 bytes minimum (required for PieceCID calculation)
const DEFAULT_MAX_PIECE_SIZE = 34091302912n // 32 GiB minus fr32 padding (32GB * 127/128)

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {}

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      options.mode = args[i + 1]
      i++
    }
  }

  // Validate mode
  const validModes = ['client', 'provider', 'both']
  if (options.mode && !validModes.includes(options.mode)) {
    error(`Invalid mode: ${options.mode}. Must be one of: ${validModes.join(', ')}`)
    process.exit(1)
  }

  return options
}

// Validation helper
function requireEnv(name, mode = null) {
  const value = process.env[name]
  if (!value) {
    const modeStr = mode ? ` (required for mode: ${mode})` : ''
    console.error(`❌ Missing required environment variable: ${name}${modeStr}`)
    process.exit(1)
  }
  return value
}

// Logging helpers
function log(message) {
  console.log(`ℹ️  ${message}`)
}

function success(message) {
  console.log(`✅ ${message}`)
}

function warning(message) {
  console.log(`⚠️  ${message}`)
}

function error(message) {
  console.error(`❌ ${message}`)
}

// Setup provider function
async function setupProvider(deployerSigner, spSigner, provider, warmStorage, spRegistry, config) {
  const {
    spName,
    spDescription,
    spServiceUrl,
    location,
    minPieceSize,
    maxPieceSize,
    storagePricePerTibPerMonth,
    minProvingPeriod,
  } = config
  const spAddress = await spSigner.getAddress()

  // === Step 1: Register Provider in ServiceProviderRegistry ===
  log('\n📋 Step 1: Service Provider Registration in Registry')

  // Check if SP is already registered
  const isRegistered = await spRegistry.isRegisteredProvider(spAddress)

  let providerId
  if (isRegistered) {
    providerId = await spRegistry.getProviderIdByAddress(spAddress)
    const providerInfo = await spRegistry.getProvider(providerId)

    if (providerInfo) {
      success(`Provider already registered with ID ${providerId}`)
      log(`  Name: ${providerInfo.name}`)
      log(`  Description: ${providerInfo.description}`)
      log(`  Location: ${providerInfo.location}`)

      // Check if we need to update the info
      if (
        providerInfo.name !== spName ||
        providerInfo.description !== spDescription ||
        provider.location !== location
      ) {
        log('Updating provider information...')
        const updateTx = await spRegistry.updateProviderInfo(spSigner, spName, spDescription)
        await updateTx.wait(1)
        success(`Provider info updated. Tx: ${updateTx.hash}`)
      }
    }
  } else {
    log(`Registering new provider: ${spName}`)
    log('Note: Registration requires a 5 FIL fee')

    // Check SP balance
    const spBalance = await provider.getBalance(spAddress)
    const requiredFee = ethers.parseEther('5')
    if (spBalance < requiredFee) {
      error(`Insufficient balance for registration. Required: 5 FIL, Available: ${ethers.formatEther(spBalance)} FIL`)
      process.exit(1)
    }

    // We need to manually register with the fee since SDK method doesn't handle it
    const contract = spRegistry._getRegistryContract().connect(spSigner)
    const registrationFee = await contract.REGISTRATION_FEE()

    // Encode PDP offering for initial registration
    const pdpOffering = {
      serviceURL: spServiceUrl,
      minPieceSizeInBytes: minPieceSize,
      maxPieceSizeInBytes: maxPieceSize,
      ipniPiece: false,
      ipniIpfs: false,
      storagePricePerTibPerMonth,
      minProvingPeriodInEpochs: minProvingPeriod,
      location,
      paymentTokenAddress: '0x0000000000000000000000000000000000000000',
    }

    const encodedOffering = await spRegistry.encodePDPOffering(pdpOffering)

    // Register with PDP product included
    // Use the SP's address as both serviceProvider (msg.sender) and payee
    const registerTx = await contract.registerProvider(
      spSigner.address, // payee address (where payments go)
      spName,
      spDescription,
      0, // ProductType.PDP
      encodedOffering,
      location ? ['location'] : [], // capability keys
      location ? [location] : [], // capability values
      { value: registrationFee }
    )

    await registerTx.wait(1)
    success(`Provider registered with PDP product. Tx: ${registerTx.hash}`)

    // Get the new provider ID
    providerId = await spRegistry.getProviderIdByAddress(spAddress)
    log(`Provider ID: ${providerId}`)
  }

  // === Step 2: Verify/Update PDP Product ===
  log('\n📦 Step 2: Verifying PDP Product Configuration')

  // Check if provider has PDP product (should have been added during registration if new)
  const hasPDP = await spRegistry.providerHasProduct(providerId, 0) // 0 = PDP product type

  if (hasPDP) {
    const pdpService = await spRegistry.getPDPService(providerId)
    if (pdpService?.isActive) {
      success('Provider has active PDP product')
      log(`  Service URL: ${pdpService.offering.serviceURL}`)
      log(`  Location: ${pdpService.offering.location}`)
      log(`  Storage Price: ${ethers.formatUnits(pdpService.offering.storagePricePerTibPerMonth, 18)} USDFC/TiB/month`)
      log(`  Min Piece Size: ${pdpService.offering.minPieceSizeInBytes} bytes`)
      log(`  Max Piece Size: ${pdpService.offering.maxPieceSizeInBytes} bytes`)

      // Check if we need to update the product
      if (
        pdpService.offering.serviceURL !== spServiceUrl ||
        pdpService.offering.location !== location ||
        pdpService.offering.storagePricePerTibPerMonth !== storagePricePerTibPerMonth
      ) {
        log('Updating PDP product configuration...')
        const pdpData = {
          serviceURL: spServiceUrl,
          minPieceSizeInBytes: minPieceSize,
          maxPieceSizeInBytes: maxPieceSize,
          ipniPiece: false,
          ipniIpfs: false,
          storagePricePerTibPerMonth,
          minProvingPeriodInEpochs: minProvingPeriod,
          location,
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        }

        const capabilities = location ? { location } : {}
        const updateTx = await spRegistry.updatePDPProduct(spSigner, pdpData, capabilities)
        await updateTx.wait(1)
        success(`PDP product updated. Tx: ${updateTx.hash}`)
      }
    }
  } else {
    // This shouldn't happen if registration worked correctly, but handle it just in case
    log('Provider missing PDP product, adding it now...')
    const pdpData = {
      serviceURL: spServiceUrl,
      minPieceSizeInBytes: minPieceSize,
      maxPieceSizeInBytes: maxPieceSize,
      ipniPiece: false,
      ipniIpfs: false,
      storagePricePerTibPerMonth,
      minProvingPeriodInEpochs: minProvingPeriod,
      location,
      paymentTokenAddress: '0x0000000000000000000000000000000000000000',
    }

    const capabilities = location ? { location } : {}
    const addProductTx = await spRegistry.addPDPProduct(spSigner, pdpData, capabilities)
    await addProductTx.wait(1)
    success(`PDP product added. Tx: ${addProductTx.hash}`)
  }

  // === Step 3: Approve Provider in WarmStorageService ===
  log('\n✅ Step 3: Provider Approval in Warm Storage')

  // Check if provider is already approved in WarmStorage
  const isApprovedInWarmStorage = await warmStorage.isProviderIdApproved(providerId)

  if (isApprovedInWarmStorage) {
    success(`Provider ID ${providerId} is already approved in Warm Storage`)
  } else {
    log(`Adding provider ID ${providerId} to Warm Storage approved list...`)
    const approveTx = await warmStorage.addApprovedProvider(deployerSigner, providerId)
    await approveTx.wait(1)
    success(`Provider approved in Warm Storage. Tx: ${approveTx.hash}`)
  }

  return providerId
}

// Setup client function
async function setupClient(clientSigner, provider, warmStorage, warmStorageAddress) {
  // === Set up client payment approvals ===
  log('\n💰 Client Payment Setup')

  // USDFC token address on calibration network
  // This is a standard token address across all deployments
  const usdfcAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
  log(`USDFC token address: ${usdfcAddress}`)

  // Create PaymentsService
  const paymentsAddress = await warmStorage.getPaymentsAddress()
  const paymentsService = new PaymentsService(provider, clientSigner, paymentsAddress, usdfcAddress)

  // Check client's USDFC balance
  const clientBalance = await paymentsService.walletBalance(TOKENS.USDFC)
  log(`Client USDFC balance: ${ethers.formatUnits(clientBalance, 18)} USDFC`)

  if (clientBalance === 0n) {
    warning('Client has no USDFC tokens. Please acquire USDFC tokens before proceeding.')
    warning('For testnet, you can get USDFC from a faucet or DEX.')
  } else {
    // Check current deposit balance
    const depositBalance = await paymentsService.balance(TOKENS.USDFC)
    log(`Current deposit balance: ${ethers.formatUnits(depositBalance, 18)} USDFC`)

    // Make initial deposit if needed
    if (depositBalance < INITIAL_DEPOSIT_AMOUNT) {
      log(`Making initial deposit of ${ethers.formatUnits(INITIAL_DEPOSIT_AMOUNT, 18)} USDFC...`)

      // First, approve the Payments contract to spend USDFC
      const currentAllowance = await paymentsService.allowance(paymentsAddress, TOKENS.USDFC)
      if (currentAllowance < INITIAL_DEPOSIT_AMOUNT) {
        log('Approving USDFC spending...')
        const approveTx = await paymentsService.approve(paymentsAddress, INITIAL_DEPOSIT_AMOUNT, TOKENS.USDFC)
        await approveTx.wait(1)
        success(`USDFC spending approved. Tx: ${approveTx.hash}`)
      }

      // Make the deposit
      const depositTx = await paymentsService.deposit(INITIAL_DEPOSIT_AMOUNT)
      await depositTx.wait(1)
      success(`Initial deposit made. Tx: ${depositTx.hash}`)
    }

    // Set up service approvals for Warm Storage
    log('Setting up service approvals for Warm Storage...')
    const currentApproval = await paymentsService.serviceApproval(warmStorageAddress, TOKENS.USDFC)

    if (
      currentApproval.rateAllowance < RATE_ALLOWANCE_PER_EPOCH ||
      currentApproval.lockupAllowance < LOCKUP_ALLOWANCE
    ) {
      log(`Approving Warm Storage as operator...`)
      log(`  Rate allowance: ${ethers.formatUnits(RATE_ALLOWANCE_PER_EPOCH, 18)} USDFC per epoch`)
      log(`  Lockup allowance: ${ethers.formatUnits(LOCKUP_ALLOWANCE, 18)} USDFC`)
      log(`  Max lockup period: ${MAX_LOCKUP_PERIOD} epochs`)

      const approvalTx = await paymentsService.approveService(
        warmStorageAddress,
        RATE_ALLOWANCE_PER_EPOCH,
        LOCKUP_ALLOWANCE,
        MAX_LOCKUP_PERIOD,
        TOKENS.USDFC
      )
      await approvalTx.wait(1)
      success(`Service approval set. Tx: ${approvalTx.hash}`)
    } else {
      success('Service approvals already configured')
    }
  }
}

async function main() {
  try {
    // Parse command line arguments
    const args = parseArgs()
    const mode = args.mode || 'client' // Default to client mode

    log(`🚀 Running post-deploy setup in '${mode}' mode`)

    // Get environment variables based on mode
    let deployerPrivateKey, spPrivateKey, clientPrivateKey, spServiceUrl

    if (mode === 'provider' || mode === 'both') {
      deployerPrivateKey = requireEnv('DEPLOYER_PRIVATE_KEY', 'provider')
      spPrivateKey = requireEnv('SP_PRIVATE_KEY', 'provider')
      spServiceUrl = requireEnv('SP_SERVICE_URL', 'provider')
    }

    if (mode === 'client' || mode === 'both') {
      clientPrivateKey = requireEnv('CLIENT_PRIVATE_KEY', 'client')
    }

    // Common configuration
    const network = process.env.NETWORK || 'calibration'
    const customRpcUrl = process.env.RPC_URL

    // Validate network
    if (network !== 'mainnet' && network !== 'calibration') {
      error('NETWORK must be either "mainnet" or "calibration"')
      process.exit(1)
    }

    // Get RPC URL
    const rpcURL = customRpcUrl || RPC_URLS[network].http

    // Get WarmStorage address - use provided or default from constants
    let warmStorageAddress = process.env.WARM_STORAGE_CONTRACT_ADDRESS
    if (!warmStorageAddress) {
      warmStorageAddress = CONTRACT_ADDRESSES.WARM_STORAGE[network]
      if (!warmStorageAddress) {
        error(`No default Warm Storage address for ${network} network. Please provide WARM_STORAGE_CONTRACT_ADDRESS.`)
        process.exit(1)
      }
      log(`Using default Warm Storage address from constants.ts: ${warmStorageAddress}`)
    }

    log(`Starting post-deployment setup for network: ${network}`)
    log(`Warm Storage contract address: ${warmStorageAddress}`)
    log(`Using RPC: ${rpcURL}`)

    // Create provider with extended timeout for Filecoin's 30s block time
    const provider = new ethers.JsonRpcProvider(rpcURL, undefined, {
      polling: 4000, // Poll every 4 seconds
      batchMaxCount: 1, // Disable batching to avoid timeout issues
    })

    // Set a longer timeout for the provider's underlying connection
    // This helps with Filecoin's slower block times
    provider._getConnection().timeout = 120000 // 2 minutes

    // Create WarmStorage service
    const warmStorage = await WarmStorageService.create(provider, warmStorageAddress)

    // Variables to track what was setup
    let providerId = null
    let providerName = null

    // === PROVIDER SETUP ===
    if (mode === 'provider' || mode === 'both') {
      const deployerSigner = new ethers.Wallet(deployerPrivateKey, provider)
      const spSigner = new ethers.Wallet(spPrivateKey, provider)

      // Get addresses
      const deployerAddress = await deployerSigner.getAddress()
      const spAddress = await spSigner.getAddress()

      log(`\nDeployer address: ${deployerAddress}`)
      log(`Service Provider address: ${spAddress}`)

      // Provider configuration
      const spName = process.env.SP_NAME || 'Test Service Provider'
      const spDescription = process.env.SP_DESCRIPTION || 'Test provider for Warm Storage'

      // PDP product configuration
      const minPieceSize = BigInt(process.env.MIN_PIECE_SIZE || DEFAULT_MIN_PIECE_SIZE.toString())
      const maxPieceSize = BigInt(process.env.MAX_PIECE_SIZE || DEFAULT_MAX_PIECE_SIZE.toString())
      const storagePricePerTibPerMonth = BigInt(
        process.env.STORAGE_PRICE_PER_TIB_PER_MONTH || DEFAULT_STORAGE_PRICE.toString()
      )
      const minProvingPeriod = Number(process.env.MIN_PROVING_PERIOD || '2880')
      const location = process.env.LOCATION || '' // Empty by default, X.509 DN format if provided

      log(`\nProvider Configuration:`)
      log(`  Name: ${spName}`)
      log(`  Service URL: ${spServiceUrl}`)
      log(`  Location: ${location}`)
      log(`  Storage Price: ${ethers.formatUnits(storagePricePerTibPerMonth, 18)} USDFC/TiB/month`)

      // Get registry address - use provided or discover from WarmStorage
      let spRegistryAddress = process.env.SP_REGISTRY_ADDRESS
      if (spRegistryAddress) {
        log(`Using provided ServiceProviderRegistry address: ${spRegistryAddress}`)
      } else {
        spRegistryAddress = warmStorage.getServiceProviderRegistryAddress()
        if (!spRegistryAddress || spRegistryAddress === ethers.ZeroAddress) {
          error(
            'Could not discover ServiceProviderRegistry address from WarmStorage. Please provide SP_REGISTRY_ADDRESS.'
          )
          process.exit(1)
        }
        log(`Auto-discovered ServiceProviderRegistry address: ${spRegistryAddress}`)
      }

      // Create registry service
      const spRegistry = new SPRegistryService(provider, spRegistryAddress)

      // Setup provider
      const config = {
        spName,
        spDescription,
        spServiceUrl,
        location,
        minPieceSize,
        maxPieceSize,
        storagePricePerTibPerMonth,
        minProvingPeriod,
      }

      providerId = await setupProvider(deployerSigner, spSigner, provider, warmStorage, spRegistry, config)
      providerName = spName
    }

    // === CLIENT SETUP ===
    if (mode === 'client' || mode === 'both') {
      const clientSigner = new ethers.Wallet(clientPrivateKey, provider)
      const clientAddress = await clientSigner.getAddress()

      log(`\nClient address: ${clientAddress}`)

      await setupClient(clientSigner, provider, warmStorage, warmStorageAddress)
    }

    // === Summary ===
    log('\n📊 Setup Summary:')

    if (mode === 'provider' || mode === 'both') {
      success(`Provider registered with ID: ${providerId}`)
      success(`Provider name: ${providerName}`)
      success(`Provider approved in Warm Storage: ✅`)
    }

    if (mode === 'client' || mode === 'both') {
      success(`Client payment approvals configured: ✅`)
    }

    log(`\n🎉 Post-deployment setup complete! (mode: ${mode})`)

    if (mode === 'provider' || mode === 'both') {
      log('\nNext steps for provider:')
      log('1. Ensure the Curio service is running at the configured URL')
      log('2. Monitor the provider status using the SDK or contract calls')
    }

    if (mode === 'client' || mode === 'both') {
      log('\nNext steps for client:')
      log('1. Use the Synapse SDK to create data sets and upload pieces')
      log('2. Monitor your payment balance and approvals')
    }
  } catch (err) {
    error(`Setup failed: ${err.message}`)
    if (err.stack) {
      console.error(err.stack)
    }
    process.exit(1)
  }
}

// Run the script
main()
