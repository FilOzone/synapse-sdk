/**
 * Example usage of the Synapse SDK
 *
 * This file demonstrates how to use the SDK for binary blob storage
 * with PDP verification and optional CDN services.
 */

import { Synapse, RPC_URLS, TOKENS } from './dist/index.js'

async function main () {
  // Initialize Synapse with your private key
  const synapse = await Synapse.create({
    // This is a test private key - DO NOT use in production!
    privateKey: process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    withCDN: true, // Enable CDN for faster retrievals (optional)
    rpcURL: RPC_URLS.calibration.http // Use recommended calibration testnet endpoint
    // Other RPC options:
    // rpcURL: RPC_URLS.calibration.websocket  // WebSocket for real-time updates
    // rpcURL: RPC_URLS.mainnet.http          // Mainnet HTTP
    // rpcURL: RPC_URLS.mainnet.websocket     // Mainnet WebSocket
    // rpcURL: 'http://192.168.1.5:2235/rpc/v1' // Custom local RPC
  })

  // Helper function to format bigint amounts to human-readable format
  function formatAmount (amount, token = 'FIL') {
    const decimals = synapse.payments.decimals(token)
    const divisor = 10n ** BigInt(decimals)
    const wholePart = amount / divisor
    const fractionalPart = amount % divisor
    // Convert fractional part to string with padding
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
    // Remove trailing zeros from fractional part
    const trimmedFractional = fractionalStr.replace(/0+$/, '')
    return trimmedFractional ? `${wholePart}.${trimmedFractional}` : wholePart.toString()
  }

  // Step 1: Check wallet balance on chain
  console.log('Checking wallet balance on chain...')
  const walletBalance = await synapse.payments.walletBalance()
  console.log(`Wallet balance: ${formatAmount(walletBalance, 'FIL')} FIL`)

  // Step 1.5: Check USDFC balance
  console.log('\nChecking USDFC balance on chain...')
  const usdcBalance = await synapse.payments.walletBalance(TOKENS.USDFC)
  console.log(`USDFC balance: ${formatAmount(usdcBalance, 'USDFC')} USDFC`)

  // Step 2: Check and manage Synapse balance
  console.log('\nChecking Synapse balance...')
  let balance = await synapse.payments.balance(TOKENS.USDFC)
  console.log(`Current balance: ${formatAmount(balance, 'USDFC')} USDFC`)

  // Deposit if balance is low (5 USDFC in smallest unit)
  const minBalanceUnit = 5n * (10n ** 18n) // 5 USDFC in smallest unit
  if (balance < minBalanceUnit) {
    const depositAmount = minBalanceUnit - balance
    console.log(`Balance too low, depositing ${formatAmount(depositAmount, 'USDFC')} USDFC...`)
    const txHash = await synapse.payments.deposit(depositAmount, TOKENS.USDFC)
    console.log(`Deposit successful, transaction: ${txHash}`)
    // Check balance after deposit
    balance = await synapse.payments.balance(TOKENS.USDFC)
    console.log(`New balance: ${formatAmount(balance, 'USDFC')} USDFC`)
  }

  // Step 2: Create a storage service instance with progress callbacks
  console.log('\nCreating storage service...')
  const storage = await synapse.createStorage({
    // providerId: 1, // Optional: use specific provider ID
    // withCDN: true, // Optional: enable CDN (must match synapse init option)
    callbacks: {
      onProviderSelected: (provider) => {
        console.log(`Selected provider: ${provider.owner}`)
        console.log(`  PDP URL: ${provider.pdpUrl}`)
      },
      onProofSetResolved: (info) => {
        if (info.isExisting) {
          console.log(`Using existing proof set: ${info.proofSetId}`)
        } else {
          console.log(`Created new proof set: ${info.proofSetId}`)
        }
      },
      onProofSetCreationStarted: (txHash, statusUrl) => {
        console.log(`Proof set creation transaction: ${txHash}`)
        if (statusUrl) {
          console.log(`  Status URL: ${statusUrl}`)
        }
      },
      onProofSetCreationProgress: (status) => {
        const elapsed = Math.round(status.elapsedMs / 1000)
        console.log(`  [${elapsed}s] Transaction mined: ${status.transactionMined}, Proof set live: ${status.proofSetLive}`)
      }
    }
  })

  console.log(`Using proof set ID: ${storage.proofSetId}`)
  console.log(`Using storage provider: ${storage.storageProvider}`)

  // Step 3: Upload binary data
  console.log('\nUploading data...')

  // Example: create some binary data
  const data = new TextEncoder().encode('Hello, Filecoin Synapse!')

  // Upload with progress callbacks
  const uploadResult = await storage.upload(data, {
    onUploadComplete: (commp) => {
      console.log(`Upload complete! CommP: ${commp}`)
    },
    onRootAdded: () => {
      console.log(`Root added to proof set`)
    }
  })

  console.log(`Upload successful!`)
  console.log(`  CommP: ${uploadResult.commp}`)
  console.log(`  Size: ${uploadResult.size} bytes`)
  console.log(`  Root ID: ${uploadResult.rootId || 'N/A'}`)
  console.log(`Data is being proven in proof set: ${storage.proofSetId}`)

  // Step 4: Download data
  console.log('\nDownloading data...')

  // Download data (uses CDN if the storage instance was created with CDN enabled)
  const downloadedData = await storage.download(uploadResult.commp)

  // Convert back to string to verify
  const text = 'Hello, Filecoin Synapse!'
  const decoder = new TextDecoder()
  const downloadedText = decoder.decode(downloadedData)
  console.log(`Downloaded: "${downloadedText}"`)
  console.log(`Download successful: ${downloadedText === text}`)

  // Note: CDN usage is determined by how the storage service was created.
  // The download method always verifies the CommP to ensure data integrity.

  // Step 5: Withdraw funds (optional)
  console.log('\nWithdrawing funds...')
  const withdrawAmount = 1n * (10n ** 18n) // 1 USDFC in smallest unit
  const withdrawTxHash = await synapse.payments.withdraw(withdrawAmount, TOKENS.USDFC)
  console.log(`Withdrawn ${formatAmount(withdrawAmount, 'USDFC')} USDFC, transaction: ${withdrawTxHash}`)
  // Check balance after withdrawal
  const finalBalance = await synapse.payments.balance(TOKENS.USDFC)
  console.log(`Final balance: ${formatAmount(finalBalance, 'USDFC')} USDFC`)
}

// Run the example
main()
