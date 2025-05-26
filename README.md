# Synapse SDK

A JavaScript/TypeScript SDK for interacting with Filecoin Synapse - a smart-contract based marketplace for storage and other services in the Filecoin ecosystem.

## Overview

The Synapse SDK provides a simple interface for storing and retrieving binary data on Filecoin using PDP (Proof of Data Possession) for verifiability. It supports optional CDN services for improved retrieval performance.

## Installation

```bash
npm install synapse-sdk
```

## Usage

```javascript
const { Synapse } = require('synapse-sdk')

// Initialize Synapse
const synapse = new Synapse({
  privateKey: '0x...',
  withCDN: true  // Optional: enable CDN for faster retrievals
})

// Check and manage balance
let balance = await synapse.balance()
if (balance < 50) {
  await synapse.deposit(50 - balance)
}

// Create a storage service instance
const storage = await synapse.createStorage()

// Upload binary data
const data = new Uint8Array([...]) // Your binary data
const uploadTask = storage.upload(data)

// Track upload progress
const commp = await uploadTask.commp()
console.log(`Generated CommP: ${commp}`)

const sp = await uploadTask.store()
console.log(`Stored with provider: ${sp}`)

const txHash = await uploadTask.done()
console.log(`Upload complete: ${txHash}`)

// Download data (commp can be either a CID object or string)
const downloadedData = await storage.download(commp)
// Also works with string:
// const downloadedData = await storage.download('baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw2zvogkbo6kqj375dposbngqq')

// Settle payments
const { settledAmount, epoch } = await storage.settlePayments()
console.log(`Settled ${settledAmount} USDFC at epoch ${epoch}`)

// Delete data
await storage.delete(commp)

// Withdraw funds
await synapse.withdraw(10)
```

## Features

- **Simple Binary Storage**: Store and retrieve binary blobs up to a specified size limit
- **PDP Verification**: Cryptographic proofs ensure your data remains available
- **Optional CDN Service**: Pay extra for CDN-accelerated retrievals
- **Payment Management**: Deposit, withdraw, and settle payments in USDFC
- **Progress Tracking**: Monitor upload progress through multiple stages

## License

Apache-2.0