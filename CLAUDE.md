# Synapse SDK Context File

This document serves as context for LLM agent sessions working with the Synapse SDK. It will be updated as development progresses.

## Overview

The Synapse SDK provides a JavaScript/TypeScript interface to Filecoin Synapse. Synapse is a smart-contract based marketplace for services in the Filecoin ecosystem, with a primary focus on storage services.

The SDK enables users to store and retrieve binary data on Filecoin with cryptographic verification and optional CDN services.

## Key Components

1. **Synapse**: The main entry point for the SDK, handling wallet management, payment operations (deposit/withdraw/balance), and storage service creation.

2. **StorageService**: 
   - Built on PDP (Proof of Data Possession) for cryptographic storage verification
   - Handles binary blob uploads and downloads
   - Manages payment settlements with storage providers
   - Supports optional CDN service for improved retrieval performance

3. **UploadTask**:
   - Tracks multi-stage upload process
   - Provides progress milestones: CommP generation, storage provider confirmation, chain commitment

4. **Protocols & Contracts**:
   - **PDP Verifier**: The main contract that holds proof sets and verifies proofs
   - **SimplePDPService**: Manages proving periods and fault reporting
   - **Verifier Contracts**: Verify that services are being properly offered
   - **Payment Rails**: Handle incremental payments between clients and storage providers

## PDP Workflow

1. Clients and providers establish a proof set for data storage verification
2. Providers add data roots to the proof set and submit periodic proofs
3. The system verifies these proofs using randomized challenges based on chain randomness
4. Faults are reported when proofs fail or are not submitted

## Architecture

The SDK follows a simple, focused design:
- A core `Synapse` class for wallet management and payment operations
- Factory method `createStorage()` for creating storage service instances
- `StorageService` class that handles binary blob storage operations
- `UploadTask` for tracking multi-stage upload progress
- Simple binary data interface (Uint8Array/ArrayBuffer)

## Usage Pattern

```typescript
// Initialize Synapse instance
const synapse = new Synapse({
  privateKey: "0x...", // For signing transactions
  withCDN: true, // Optional: enable CDN retrievals
  rpcAPI: "https://api.node.glif.io/rpc/v1", // Optional
})

// Check and manage balance
let balance = await synapse.balance()
if (balance < 50) {
  balance = await synapse.deposit(50 - balance)
}

// Create a storage service instance
const storage = await synapse.createStorage({
  proofSetId: "...", // Optional: use existing proof set
  storageProvider: "f01234" // Optional: preferred SP
})

// Upload binary data
const data = new Uint8Array([...]) // Your binary blob
const uploadTask = storage.upload(data)

// Track upload progress
const commp = await uploadTask.commp()
const sp = await uploadTask.store()
const txHash = await uploadTask.done()

// Download data
const downloadedData = await storage.download(commp, {
  noVerify: false, // Verify against CommP
  withCDN: true // Use CDN if available
})

// Settle payments
const { settledAmount, epoch } = await storage.settlePayments()

// Delete data
await storage.delete(commp)

// Withdraw funds
await synapse.withdraw(10)
```

## Design Decisions

1. **Core API Design**:
   - Simple constructor pattern with options object
   - Factory method `createStorage()` for service instances
   - Direct payment methods on Synapse instance: `deposit()`, `withdraw()`, `balance()`
   - No "payment" prefix for cleaner API

2. **Binary-First Approach**:
   - Focus on binary blobs (Uint8Array/ArrayBuffer) only
   - No file or directory abstractions
   - Use CommP (Piece CID) as the primary identifier
   - Client-side CommP calculation for verification

3. **CDN Integration**:
   - Optional CDN service configured at SDK initialization
   - Per-download override capability
   - Trust-based model with option to verify

4. **Storage Service Design**:
   - Asynchronous upload tracking via UploadTask
   - Simple binary upload/download methods
   - Payment settlement per storage provider
   - Delete capability for data management

5. **TypeScript Styling**:
   - No semicolons (following modern JavaScript style)
   - Clear type definitions for all options
   - Comprehensive exports for all public interfaces

## Implementation Notes

The SDK is designed for Milestone 1 of the Filecoin Synapse project:
- Works with 2-3 known storage providers (hardcoded initially)
- Limited binary blob size
- Full piece retrievals only (no byte ranges)
- Optional CDN service for improved retrieval performance
- Pay-for-what-you-store payment model

Future enhancements may include:
- Dynamic storage provider discovery
- Byte range retrievals
- PoRep-based archival storage
- Advanced SLA configurations

This document will be updated as the SDK implementation progresses.