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

  // Step 2: Create a storage service instance
  console.log('\nCreating storage service...')
  const storage = await synapse.createStorage({
    // proofSetId: '...', // Optional: use existing proof set
    // storageProvider: 'f01234' // Optional: preferred storage provider
  })

  console.log(`Using proof set ID: ${storage.proofSetId}`)
  console.log(`Using storage provider: ${storage.storageProvider}`)

  // Step 3: Upload binary data
  console.log('\nUploading data...')

  // Example: create some binary data
  const data = new TextEncoder().encode('Hello, Filecoin Synapse!')

  // Start upload
  const uploadTask = storage.upload(data)

  // Track upload progress
  const commp = await uploadTask.commp()
  console.log(`Generated CommP: ${commp}`)

  const sp = await uploadTask.store()
  console.log(`Stored data with provider: ${sp}`)

  const txHash = await uploadTask.done()
  console.log(`Blob committed on chain: ${txHash}`)
  console.log(`Data is being proven in proof set: ${storage.proofSetId}`)

  // Step 4: Download data
  console.log('\nDownloading data...')

  // Download with default settings (uses CDN if enabled, verifies by default)
  const downloadedData = await storage.download(commp)

  // Convert back to string to verify
  const text = 'Hello, Filecoin Synapse!'
  const decoder = new TextDecoder()
  const downloadedText = decoder.decode(downloadedData)
  console.log(`Downloaded: "${downloadedText}"`)
  console.log(`Download successful: ${downloadedText === text}`)

  // Example: Download without CDN (direct from SP)
  console.log('\nDownloading directly from SP (no CDN)...')
  const directData = await storage.download(commp, { withCDN: false })
  console.log(`Direct download successful: ${decoder.decode(directData) === text}`)

  // Example: Download without verification (faster but less secure)
  console.log('\nDownloading without verification...')
  const unverifiedData = await storage.download(commp, { noVerify: true })
  console.log(`Unverified download successful: ${decoder.decode(unverifiedData) === text}`)

  // Step 5: Settle payments
  console.log('\nSettling payments...')
  const { settledAmount, epoch } = await storage.settlePayments()
  console.log(`Settled payment rail for epoch ${epoch}`)
  console.log(`Settlement cost: ${formatAmount(settledAmount, 'USDFC')} USDFC`)

  // Step 6: Delete data (optional)
  console.log('\nDeleting data...')
  await storage.delete(commp)
  console.log(`Deleted blob with CommP ${commp} from proof set ${storage.proofSetId}`)

  // Step 7: Withdraw funds (optional)
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
