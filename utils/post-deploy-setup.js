#!/usr/bin/env node

/**
 * Post-Deployment Setup Script for Synapse
 *
 * This script sets up a deployed Warm Storage contract by:
 * 1. Registering a service provider with ServiceProviderRegistry
 * 2. Adding a PDP product to the provider
 * 3. Approving the provider in WarmStorageService
 * 4. Setting up client payment approvals
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
 * DEPLOYER_PRIVATE_KEY=0x... \
 * SP_PRIVATE_KEY=0x... \
 * CLIENT_PRIVATE_KEY=0x... \
 * WARM_STORAGE_CONTRACT_ADDRESS=0x... \
 * SP_REGISTRY_ADDRESS=0x... \
 * NETWORK=calibration \
 * SP_SERVICE_URL=http://your-curio-node:4702 \
 * node utils/post-deploy-setup.js
 * ```
 *
 * === REQUIRED ENVIRONMENT VARIABLES ===
 *
 * - DEPLOYER_PRIVATE_KEY: Private key of the Warm Storage contract deployer/owner
 * - SP_PRIVATE_KEY: Private key of the service provider
 * - CLIENT_PRIVATE_KEY: Private key of the client who will use storage
 * - WARM_STORAGE_CONTRACT_ADDRESS: Deployed Warm Storage contract address
 * - SP_REGISTRY_ADDRESS: Deployed ServiceProviderRegistry address
 * - NETWORK: Either 'mainnet' or 'calibration' (default: calibration)
 * - SP_SERVICE_URL: Service provider's Curio HTTP endpoint
 *
 * === OPTIONAL ENVIRONMENT VARIABLES ===
 *
 * - RPC_URL: Custom RPC endpoint (overrides default network RPC)
 * - SP_NAME: Provider name (default: "Test Service Provider")
 * - SP_DESCRIPTION: Provider description (default: "Test provider for Warm Storage")
 * - MIN_PIECE_SIZE: Minimum piece size in bytes (default: 65)
 * - MAX_PIECE_SIZE: Maximum piece size in bytes (default: 34091302912 - 32GiB minus fr32 padding)
 * - STORAGE_PRICE_PER_TIB_PER_MONTH: Price in smallest USDFC unit (default: 5000000000000000000 - 5 USDFC)
 * - MIN_PROVING_PERIOD: Minimum proving period in epochs (default: 2880)
 * - LOCATION: Provider location in X.509 DN format (default: empty, example: "/C=US/ST=California/L=San Francisco")
 */

import { ethers } from 'ethers'
import { PaymentsService } from '../dist/payments/service.js'
import { SPRegistryService } from '../dist/sp-registry/service.js'
import { TOKENS } from '../dist/utils/constants.js'
import { WarmStorageService } from '../dist/warm-storage/service.js'

// Network RPC URLs
const RPC_URLS = {
  mainnet: {
    http: 'https://api.node.glif.io/rpc/v1',
  },
  calibration: {
    http: 'https://api.calibration.node.glif.io/rpc/v1',
  },
}

// Constants for payment approvals
const RATE_ALLOWANCE_PER_EPOCH = ethers.parseUnits('0.1', 18) // 0.1 USDFC per epoch
const LOCKUP_ALLOWANCE = ethers.parseUnits('10', 18) // 10 USDFC lockup allowance
const MAX_LOCKUP_PERIOD = 86400n // 30 days in epochs (30 * 2880 epochs/day)
const INITIAL_DEPOSIT_AMOUNT = ethers.parseUnits('1', 18) // 1 USDFC initial deposit

// Default PDP configuration values
const DEFAULT_STORAGE_PRICE = 5000000000000000000n // 5 USDFC per TiB per month (with 18 decimals)
const DEFAULT_MIN_PIECE_SIZE = 65n // 65 bytes minimum (required for PieceCID calculation)
const DEFAULT_MAX_PIECE_SIZE = 34091302912n // 32 GiB minus fr32 padding (32GB * 127/128)

// Validation helper
function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`)
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

async function main() {
  try {
    // Get environment variables
    const deployerPrivateKey = requireEnv('DEPLOYER_PRIVATE_KEY')
    const spPrivateKey = requireEnv('SP_PRIVATE_KEY')
    const clientPrivateKey = requireEnv('CLIENT_PRIVATE_KEY')
    const warmStorageAddress = requireEnv('WARM_STORAGE_CONTRACT_ADDRESS')
    const spRegistryAddress = requireEnv('SP_REGISTRY_ADDRESS')

    const network = process.env.NETWORK || 'calibration'
    const customRpcUrl = process.env.RPC_URL
    const spServiceUrl = process.env.SP_SERVICE_URL || 'https://service.example.com'
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

    // Validate network
    if (network !== 'mainnet' && network !== 'calibration') {
      error('NETWORK must be either "mainnet" or "calibration"')
      process.exit(1)
    }

    // Get RPC URL
    const rpcURL = customRpcUrl || RPC_URLS[network].http

    log(`Starting post-deployment setup for network: ${network}`)
    log(`Warm Storage contract address: ${warmStorageAddress}`)
    log(`ServiceProviderRegistry address: ${spRegistryAddress}`)
    log(`Using RPC: ${rpcURL}`)
    log(`\nProvider Configuration:`)
    log(`  Name: ${spName}`)
    log(`  Service URL: ${spServiceUrl}`)
    log(`  Location: ${location}`)
    log(`  Storage Price: ${Number(storagePricePerTibPerMonth) / 1000000} USDFC/TiB/month`)

    // Create providers and signers with extended timeout for Filecoin's 30s block time
    const provider = new ethers.JsonRpcProvider(rpcURL, undefined, {
      polling: 4000, // Poll every 4 seconds
      batchMaxCount: 1, // Disable batching to avoid timeout issues
    })

    // Set a longer timeout for the provider's underlying connection
    // This helps with Filecoin's slower block times
    provider._getConnection().timeout = 120000 // 2 minutes

    const deployerSigner = new ethers.Wallet(deployerPrivateKey, provider)
    const spSigner = new ethers.Wallet(spPrivateKey, provider)
    const clientSigner = new ethers.Wallet(clientPrivateKey, provider)

    // Get addresses
    const deployerAddress = await deployerSigner.getAddress()
    const spAddress = await spSigner.getAddress()
    const clientAddress = await clientSigner.getAddress()

    log(`Deployer address: ${deployerAddress}`)
    log(`Service Provider address: ${spAddress}`)
    log(`Client address: ${clientAddress}`)

    // Create service instances
    const spRegistry = new SPRegistryService(provider, spRegistryAddress)
    const warmStorage = await WarmStorageService.create(provider, warmStorageAddress)

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

        // Check if we need to update the info
        if (providerInfo.name !== spName || providerInfo.description !== spDescription) {
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
      const registerTx = await contract.registerProvider(
        spName,
        spDescription,
        0, // ProductType.PDP
        encodedOffering,
        [location ? 'location' : ''].filter(Boolean), // capability keys
        [location || ''].filter(Boolean), // capability values
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
        log(`  Storage Price: ${Number(pdpService.offering.storagePricePerTibPerMonth) / 1000000} USDFC/TiB/month`)
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

    // === Step 4: Set up client payment approvals ===
    log('\n💰 Step 4: Client Payment Setup')

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

    // === Summary ===
    log('\n📊 Setup Summary:')
    success(`Provider registered with ID: ${providerId}`)
    success(`Provider name: ${spName}`)
    success(`Service URL: ${spServiceUrl}`)
    success(`Provider approved in Warm Storage: ✅`)
    success(`Client payment approvals configured: ✅`)

    log('\n🎉 Post-deployment setup complete!')
    log('The service provider is now ready to accept storage requests.')
    log('\nNext steps:')
    log('1. Ensure the Curio service is running at the configured URL')
    log('2. Use the Synapse SDK to create data sets and upload pieces')
    log('3. Monitor the provider status using the SDK or contract calls')
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
