/**
 * Example usage of the Synapse SDK
 * 
 * This file demonstrates how to use the SDK for binary blob storage
 * with PDP verification and optional CDN services.
 */

const { Synapse } = require('synapse-sdk')

async function main() {
  // Initialize Synapse with your private key
  const synapse = new Synapse({
    privateKey: process.env.PRIVATE_KEY || '0x...', // Your private key
    withCDN: true, // Enable CDN for faster retrievals (optional)
    // rpcAPI: 'https://api.node.glif.io/rpc/v1', // Optional: custom RPC endpoint
    // subgraphAPI: '...', // Optional: custom subgraph endpoint
    // serviceContract: '0x...', // Optional: custom service contract
  })

  // Step 1: Check and manage balance
  console.log('Checking balance...')
  let balance = await synapse.balance()
  console.log(`Current balance: ${balance} USDFC`)
  
  // Deposit if balance is low
  if (balance < 50) {
    console.log(`Balance too low, depositing ${50 - balance} USDFC...`)
    balance = await synapse.deposit(50 - balance)
    console.log(`Deposit successful, new balance: ${balance} USDFC`)
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
  console.log(`Settlement cost: ${settledAmount} USDFC`)

  // Step 6: Delete data (optional)
  console.log('\nDeleting data...')
  await storage.delete(commp)
  console.log(`Deleted blob with CommP ${commp} from proof set ${storage.proofSetId}`)

  // Step 7: Withdraw funds (optional)
  console.log('\nWithdrawing funds...')
  const withdrawAmount = 10
  const newBalance = await synapse.withdraw(withdrawAmount)
  console.log(`Withdrawn ${withdrawAmount} USDFC, new balance: ${newBalance} USDFC`)
}

// Advanced example: Upload larger binary data
async function uploadLargeData() {
  const synapse = new Synapse({
    privateKey: process.env.PRIVATE_KEY,
    withCDN: true
  })
  
  const storage = await synapse.createStorage()
  
  // Create 1MB of random data
  const largeData = new Uint8Array(1024 * 1024)
  for (let i = 0; i < largeData.length; i++) {
    largeData[i] = Math.floor(Math.random() * 256)
  }
  
  console.log('Uploading 1MB of data...')
  const uploadTask = storage.upload(largeData)
  
  const commp = await uploadTask.commp()
  console.log(`CommP for 1MB data: ${commp}`)
  
  await uploadTask.done()
  console.log('Large upload complete!')
  
  return commp
}

// Run the example
if (require.main === module) {
  main().catch(console.error)
}

module.exports = { main, uploadLargeData }