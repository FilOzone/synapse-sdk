#!/usr/bin/env node

/**
 * Post-Deployment Setup Script for Synapse/Warm Storage
 *
 * This script sets up a newly deployed Warm Storage contract by:
 * 1. Registering a service provider with the contract
 * 2. Approving the service provider registration (using deployer account)
 * 3. Setting up client payment approvals for the Warm Storage contract
 *
 * === DEPLOYMENT CONTEXT ===
 *
 * This script is designed to work with Warm Storage contracts deployed using the tools from:
 * https://github.com/FilOzone/filecoin-services/tree/main/service_contracts/tools
 *
 * Example deployment command for Calibration testnet:
 * ```bash
 * cd FilOzone-filecoin-services/service_contracts
 * PDP_VERIFIER_ADDRESS=0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC \
 * PAYMENTS_CONTRACT_ADDRESS=0x0E690D3e60B0576D01352AB03b258115eb84A047 \
 * ./tools/deploy-warm-storage-calibnet.sh
 * ```
 *
 * Common contract addresses for Calibration testnet:
 * - PDP_VERIFIER_ADDRESS: 0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC
 * - PAYMENTS_CONTRACT_ADDRESS: 0x0E690D3e60B0576D01352AB03b258115eb84A047
 * - USDFC_TOKEN_ADDRESS: 0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0
 *
 * The deployment script will output the newly deployed Warm Storage contract address,
 * which should be used as the WARM_STORAGE_CONTRACT_ADDRESS for this setup script.
 *
 * === USAGE ===
 *
 * After deploying a new Warm Storage contract, run this script to complete the setup:
 *
 * ```bash
 * cd synapse-sdk
 * DEPLOYER_PRIVATE_KEY=0x... \
 * SP_PRIVATE_KEY=0x... \
 * CLIENT_PRIVATE_KEY=0x... \
 * WARM_STORAGE_CONTRACT_ADDRESS=0x... \
 * NETWORK=calibration \
 * SP_SERVICE_URL=http://your-curio-node:4702 \
 * node utils/post-deploy-setup.js
 * ```
 *
 * === REQUIRED ENVIRONMENT VARIABLES ===
 *
 * - DEPLOYER_PRIVATE_KEY: Private key of the Warm Storage contract deployer/owner
 * - SP_PRIVATE_KEY: Private key of the service provider
 * - CLIENT_PRIVATE_KEY: Private key of the client
 * - WARM_STORAGE_CONTRACT_ADDRESS: Address of the deployed Warm Storage contract
 *
 * === OPTIONAL ENVIRONMENT VARIABLES ===
 *
 * - NETWORK: Either 'mainnet' or 'calibration' (defaults to 'calibration')
 * - RPC_URL: Custom RPC URL (uses default Glif endpoints if not provided)
 * - SP_SERVICE_URL: Service provider endpoint URL (defaults to example URL)
 *
 * === WHAT THIS SCRIPT DOES ===
 *
 * 1. **Service Provider Registration:**
 *    - Checks if SP is already approved
 *    - If approved, checks if URL matches the provided SP_SERVICE_URL
 *    - If URL has changed:
 *      - Removes the existing provider registration (calls removeServiceProvider)
 *      - Re-registers with new URL (calls registerServiceProvider)
 *      - Approves the new registration (calls approveServiceProvider)
 *    - If not approved, registers and approves as normal
 *    - Validates deployer is contract owner
 *
 * 2. **Client Payment Setup:**
 *    - Sets USDFC allowance for payments contract (100 epochs worth)
 *    - Sets operator approval for Warm Storage contract (0.1 USDFC/epoch, 10 USDFC lockup)
 *    - Only updates approvals if they don't match desired values
 *
 * 3. **ERC20 Allowance Management:**
 *    - Checks current allowances before making transactions
 *    - Sets appropriate allowances for payments contract to pull USDFC
 *    - Uses the SDK's built-in allowance/approval methods
 *
 * 4. **Status Reporting:**
 *    - Comprehensive progress indicators
 *    - Final status report with all configuration details
 *    - Balance checks and warnings
 *    - Transaction hashes for all operations
 *
 * === IMPORTANT NOTES ===
 *
 * - Ensure all accounts have sufficient FIL for gas costs (expect 0.5-1 FIL per operation)
 * - Service provider registration requires a 1 FIL fee (paid to the contract)
 * - Client account should have USDFC tokens for testing payments
 */

import { ethers } from 'ethers'
import { Synapse } from '../dist/index.js'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES, RPC_URLS, TOKENS } from '../dist/utils/constants.js'
import { WarmStorageService } from '../dist/warm-storage/index.js'

// Constants for payment approvals
const RATE_ALLOWANCE_PER_EPOCH = ethers.parseUnits('0.1', 18) // 0.1 USDFC per epoch
const LOCKUP_ALLOWANCE = ethers.parseUnits('10', 18) // 10 USDFC lockup allowance
const MAX_LOCKUP_PERIOD = 86400n // 30 days in epochs (30 * 2880 epochs/day)
const INITIAL_DEPOSIT_AMOUNT = ethers.parseUnits('1', 18) // 1 USDFC initial deposit

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

    const network = process.env.NETWORK || 'calibration'
    const customRpcUrl = process.env.RPC_URL
    const spServiceUrl = process.env.SP_SERVICE_URL || 'https://service.example.com'

    // Validate network
    if (network !== 'mainnet' && network !== 'calibration') {
      error('NETWORK must be either "mainnet" or "calibration"')
      process.exit(1)
    }

    // Get RPC URL
    const rpcURL = customRpcUrl || RPC_URLS[network].http

    log(`Starting post-deployment setup for network: ${network}`)
    log(`Warm Storage contract address: ${warmStorageAddress}`)
    log(`Using RPC: ${rpcURL}`)

    // Create providers and signers
    const provider = new ethers.JsonRpcProvider(rpcURL)
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

    const spTool = new WarmStorageService(provider, warmStorageAddress)

    // === Step 1: Service Provider Registration ===
    log('\n📋 Step 1: Service Provider Registration')

    // Check if SP is already approved
    const isAlreadyApproved = await spTool.isProviderApproved(spAddress)

    if (isAlreadyApproved) {
      // Check if URL matches what we want
      const spId = await spTool.getProviderIdByAddress(spAddress)
      const currentInfo = await spTool.getApprovedProvider(spId)

      const urlMatches = currentInfo.serviceURL === spServiceUrl

      if (urlMatches) {
        success('Service provider is already approved with correct URL')
      } else {
        warning('Service provider URL has changed, re-registering...')
        log(`  Current URL: ${currentInfo.serviceURL}`)
        log(`  New URL: ${spServiceUrl}`)

        // Step 1: Remove the existing provider (as owner)
        log('Removing existing provider registration...')
        const removeTx = await spTool.removeServiceProvider(deployerSigner, spId)
        success(`Provider removal transaction sent. Tx: ${removeTx.hash}`)
        await removeTx.wait()
        success('Provider removed successfully')

        // Step 2: Register with new URL (as SP)
        log('Registering service provider with new URL (requires 1 FIL fee)...')
        const registerTx = await spTool.registerServiceProvider(spSigner, spServiceUrl, '')
        success(`Service provider registration transaction sent. Tx: ${registerTx.hash}`)
        await registerTx.wait()
        success('Service provider registered successfully')

        // Step 3: Approve the new registration (as owner)
        log('Approving service provider registration...')
        const warmStorageContract = new ethers.Contract(warmStorageAddress, CONTRACT_ABIS.WARM_STORAGE, deployerSigner)

        try {
          // Estimate gas first
          const gasEstimate = await warmStorageContract.approveServiceProvider.estimateGas(spAddress)
          log(`Gas estimate: ${gasEstimate}`)

          // Add 50% buffer for Filecoin network
          const gasLimit = gasEstimate + (gasEstimate * 50n) / 100n
          const maxGasLimit = 30_000_000n // 30M gas max for Filecoin calibration
          const finalGasLimit = gasLimit > maxGasLimit ? maxGasLimit : gasLimit

          log(`Using gas limit: ${finalGasLimit}`)

          const approveTx = await warmStorageContract.approveServiceProvider(spAddress, {
            gasLimit: finalGasLimit,
          })
          success(`Service provider approval transaction sent. Tx: ${approveTx.hash}`)
          await approveTx.wait()
          success('Service provider approved successfully')
        } catch (approveError) {
          // Try to get more detailed error info
          try {
            await warmStorageContract.approveServiceProvider.staticCall(spAddress)
            throw approveError // Re-throw original if static call works
          } catch (staticError) {
            error(`Contract call would revert: ${staticError.reason || staticError.message}`)
            throw staticError
          }
        }
      }
    } else {
      // Check if SP has a pending registration
      let hasPendingRegistration = false
      try {
        const pendingInfo = await spTool.getPendingProvider(spAddress)
        // If we get here, there is a pending registration
        hasPendingRegistration = true
        warning('Service provider has pending registration')
        log(`  Service URL: ${pendingInfo.serviceURL}`)
        log(`  Registered at: ${new Date(Number(pendingInfo.registeredAt) * 1000).toISOString()}`)
      } catch (err) {
        // No pending registration found (this is expected for new providers)
        hasPendingRegistration = false
      }

      if (!hasPendingRegistration) {
        // Register the service provider
        log('Registering service provider (requires 1 FIL fee)...')
        const registerTx = await spTool.registerServiceProvider(spSigner, spServiceUrl, '')
        success(`Service provider registration transaction sent. Tx: ${registerTx.hash}`)
        await registerTx.wait()
        success('Service provider registered successfully')
      }

      // === Step 2: Approve Service Provider (as deployer) ===
      log('\n✅ Step 2: Approve Service Provider')

      const deployerSpTool = new WarmStorageService(provider, warmStorageAddress)

      // Verify deployer is contract owner
      const isOwner = await deployerSpTool.isOwner(deployerSigner)
      if (!isOwner) {
        error('Deployer is not the contract owner. Cannot approve service provider.')
        process.exit(1)
      }

      log('Approving service provider as contract owner...')

      // Create contract instance directly to set gas limit
      const warmStorageContract = new ethers.Contract(warmStorageAddress, CONTRACT_ABIS.WARM_STORAGE, deployerSigner)

      try {
        // Estimate gas first
        const gasEstimate = await warmStorageContract.approveServiceProvider.estimateGas(spAddress)
        log(`Gas estimate: ${gasEstimate}`)

        // Add 50% buffer for Filecoin network
        const gasLimit = gasEstimate + (gasEstimate * 50n) / 100n
        const maxGasLimit = 30_000_000n // 30M gas max for Filecoin calibration
        const finalGasLimit = gasLimit > maxGasLimit ? maxGasLimit : gasLimit

        log(`Using gas limit: ${finalGasLimit}`)

        const approveTx = await warmStorageContract.approveServiceProvider(spAddress, {
          gasLimit: finalGasLimit,
        })
        await approveTx.wait()
        success(`Service provider approved successfully. Tx: ${approveTx.hash}`)
      } catch (approveError) {
        // Try to get more detailed error info
        try {
          await warmStorageContract.approveServiceProvider.staticCall(spAddress)
          throw approveError // Re-throw original if static call works
        } catch (staticError) {
          error(`Contract call would revert: ${staticError.reason || staticError.message}`)
          throw staticError
        }
      }
    }

    // === Step 3: Client Payment Setup ===
    log('\n💰 Step 3: Client Payment Setup')

    // Create Synapse instance for client
    const clientSynapse = await Synapse.create({
      privateKey: clientPrivateKey,
      rpcURL,
      network,
    })

    const paymentsAddress = CONTRACT_ADDRESSES.PAYMENTS[network]
    if (!paymentsAddress || paymentsAddress === '') {
      error(`Payments contract not available on ${network} network`)
      process.exit(1)
    }

    // Check current USDFC allowance for payments contract
    log('Checking USDFC allowance for payments contract...')
    const currentAllowance = await clientSynapse.payments.allowance(TOKENS.USDFC, paymentsAddress)
    const requiredAllowance = RATE_ALLOWANCE_PER_EPOCH * 100n // 100 epochs worth

    if (currentAllowance < requiredAllowance) {
      log(`Current allowance: ${ethers.formatUnits(currentAllowance, 18)} USDFC`)
      log(`Required allowance: ${ethers.formatUnits(requiredAllowance, 18)} USDFC`)
      log('Approving USDFC spending for payments contract...')

      const approveTx = await clientSynapse.payments.approve(TOKENS.USDFC, paymentsAddress, requiredAllowance)
      success(`USDFC approval transaction sent. Tx: ${approveTx.hash}`)
      await approveTx.wait()
      success('USDFC approval confirmed')
    } else {
      success(`USDFC allowance already sufficient: ${ethers.formatUnits(currentAllowance, 18)} USDFC`)
    }

    // Check and deposit USDFC into Payments contract
    log('Checking USDFC balance in Payments contract...')
    const currentBalance = await clientSynapse.payments.balance(TOKENS.USDFC)
    log(`Current deposit balance: ${ethers.formatUnits(currentBalance, 18)} USDFC`)

    if (currentBalance < INITIAL_DEPOSIT_AMOUNT) {
      log(`Depositing ${ethers.formatUnits(INITIAL_DEPOSIT_AMOUNT, 18)} USDFC into Payments contract...`)

      // Check wallet has enough USDFC
      const walletBalance = await clientSynapse.payments.walletBalance(TOKENS.USDFC)
      if (walletBalance < INITIAL_DEPOSIT_AMOUNT) {
        error(`Insufficient USDFC balance in wallet: ${ethers.formatUnits(walletBalance, 18)} USDFC`)
        error(`Need at least ${ethers.formatUnits(INITIAL_DEPOSIT_AMOUNT, 18)} USDFC`)
        process.exit(1)
      }

      const depositTx = await clientSynapse.payments.deposit(INITIAL_DEPOSIT_AMOUNT, TOKENS.USDFC)
      success(`USDFC deposit transaction sent. Tx: ${depositTx.hash}`)
      await depositTx.wait()
      success(`Deposited ${ethers.formatUnits(INITIAL_DEPOSIT_AMOUNT, 18)} USDFC successfully`)
    } else {
      success(`USDFC deposit already sufficient: ${ethers.formatUnits(currentBalance, 18)} USDFC`)
    }

    // Check current operator approval for Warm Storage contract
    log('Checking operator approval for Warm Storage contract...')
    const currentApproval = await clientSynapse.payments.serviceApproval(warmStorageAddress, TOKENS.USDFC)

    const needsUpdate =
      !currentApproval.isApproved ||
      currentApproval.rateAllowance < RATE_ALLOWANCE_PER_EPOCH ||
      currentApproval.lockupAllowance < LOCKUP_ALLOWANCE

    if (needsUpdate) {
      log('Current approval status:')
      log(`  Approved: ${currentApproval.isApproved}`)
      log(`  Rate allowance: ${ethers.formatUnits(currentApproval.rateAllowance, 18)} USDFC/epoch`)
      log(`  Lockup allowance: ${ethers.formatUnits(currentApproval.lockupAllowance, 18)} USDFC`)

      log('Setting operator approval for Warm Storage contract...')
      const approveServiceTx = await clientSynapse.payments.approveService(
        warmStorageAddress,
        RATE_ALLOWANCE_PER_EPOCH,
        LOCKUP_ALLOWANCE,
        MAX_LOCKUP_PERIOD,
        TOKENS.USDFC
      )
      success(`Operator approval transaction sent. Tx: ${approveServiceTx.hash}`)
      await approveServiceTx.wait()
      success('Operator approval confirmed')
    } else {
      success('Operator approval already configured correctly')
      log(`  Rate allowance: ${ethers.formatUnits(currentApproval.rateAllowance, 18)} USDFC/epoch`)
      log(`  Lockup allowance: ${ethers.formatUnits(currentApproval.lockupAllowance, 18)} USDFC`)
    }

    // === Final Status Report ===
    log('\n📊 Setup Complete - Final Status:')

    // SP status
    const finalSpApproval = await spTool.isProviderApproved(spAddress)
    if (finalSpApproval) {
      const spId = await spTool.getProviderIdByAddress(spAddress)
      const spInfo = await spTool.getApprovedProvider(spId)
      success(`✓ Service Provider approved (ID: ${spId})`)
      log(`  Service URL: ${spInfo.serviceURL}`)
    } else {
      error('✗ Service Provider not approved')
    }

    // Client payment status
    const finalAllowance = await clientSynapse.payments.allowance(TOKENS.USDFC, paymentsAddress)
    const finalApproval = await clientSynapse.payments.serviceApproval(warmStorageAddress, TOKENS.USDFC)
    const finalDepositBalance = await clientSynapse.payments.balance(TOKENS.USDFC)

    success(`✓ Client USDFC allowance: ${ethers.formatUnits(finalAllowance, 18)} USDFC`)
    success(`✓ Client USDFC deposit balance: ${ethers.formatUnits(finalDepositBalance, 18)} USDFC`)
    success(`✓ Client operator approval: ${finalApproval.isApproved}`)
    log(`  Rate allowance: ${ethers.formatUnits(finalApproval.rateAllowance, 18)} USDFC/epoch`)
    log(`  Lockup allowance: ${ethers.formatUnits(finalApproval.lockupAllowance, 18)} USDFC`)
    log(`  Max lockup period: ${finalApproval.maxLockupPeriod} epochs (${finalApproval.maxLockupPeriod / 2880n} days)`)

    // Check client USDFC balance
    const clientBalance = await clientSynapse.payments.walletBalance(TOKENS.USDFC)
    log(`\n💳 Client USDFC balance: ${ethers.formatUnits(clientBalance, 18)} USDFC`)

    if (clientBalance < LOCKUP_ALLOWANCE) {
      warning('Client USDFC balance is low. Consider funding with more USDFC for testing.')
      log(`USDFC contract address: ${CONTRACT_ADDRESSES.USDFC[network]}`)
    }

    success('\n🎉 Post-deployment setup completed successfully!')
    log('\nThe system is now ready for:')
    log('• Creating data sets')
    log('• Adding pieces')
    log('• Processing payments')
  } catch (err) {
    error(`Setup failed: ${err.message}`)
    if (err.code) {
      log(`Error code: ${err.code}`)
    }
    if (err.reason) {
      log(`Reason: ${err.reason}`)
    }
    console.error(err.stack)
    process.exit(1)
  }
}

// Handle CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    error(`Unhandled error: ${err.message}`)
    console.error(err)
    process.exit(1)
  })
}

export { main }
