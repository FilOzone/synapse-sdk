# Storage Service E2E Implementation Plan

This document outlines the step-by-step implementation plan for converting the mock storage service into a fully functional storage system integrated with PDP (Proof of Data Possession) and Pandora contracts.

## Overview

The goal is to implement `upload(bytes)` and `download(commp)` methods on `SynapseStorage` that interact with real storage providers through the PDP protocol. The implementation will handle provider selection, proof set management, preflight checks, and provide progress callbacks.

## Prerequisites

- [ ] Verify all existing tests pass
- [ ] Ensure understanding of the PDP flow from examples
- [ ] Review Curio HTTP API documentation

## Implementation Steps

### Step 1: Move Shared Types

- [x] Move `ApprovedProviderInfo` interface from `src/pdp/storage-provider.ts` to `src/types.ts`
- [x] Add new types needed for storage service:
  ```typescript
  interface StorageServiceOptions {
    providerId?: number
    withCDN?: boolean
  }
  
  interface PreflightInfo {
    estimatedCost: {
      perEpoch: bigint
      perDay: bigint
      perMonth: bigint
    }
    allowanceCheck: {
      sufficient: boolean
      message?: string
    }
    selectedProvider: ApprovedProviderInfo
    selectedProofSetId: number
  }
  
  interface UploadCallbacks {
    onSetup?: (status: SetupStatus) => void
    onProofSetCreated?: (id: number, txn: string) => void
    onUploadComplete?: (commp: string) => void
    onRootAdded?: () => void
  }
  
  interface SetupStatus {
    provider: ApprovedProviderInfo
    proofSetId?: number
    needsNewProofSet: boolean
  }
  
  interface UploadResult {
    commp: string
    size: number
    rootId?: number
  }
  ```

### Step 2: Create Real Storage Service Class

- [x] Create `src/storage/storage-service.ts` (new directory)
- [x] Add required imports:
  ```typescript
  import type { ethers } from 'ethers'
  import type {
    StorageServiceOptions,
    ApprovedProviderInfo,
    UploadTask,
    DownloadOptions,
    SettlementResult,
    PreflightInfo,
    UploadCallbacks,
    CommP
  } from '../types.js'
  import type { Synapse } from '../synapse.js'
  import { PDPServer } from '../pdp/server.js'
  import { PDPAuthHelper } from '../pdp/auth.js'
  import { PandoraService } from '../pandora/service.js'
  import { createError } from '../utils/index.js'
  ```
- [x] Implement basic class structure:
  ```typescript
  export class StorageService {
    private readonly _synapse: Synapse
    private readonly _provider: ApprovedProviderInfo
    private readonly _pdpServer: PDPServer
    private readonly _pandoraService: PandoraService
    private readonly _pandoraAddress: string
    private readonly _withCDN: boolean
    private readonly _proofSetId: number
    private readonly _signer: ethers.Signer
    
    // Public properties from interface
    public readonly proofSetId: string
    public readonly storageProvider: string
  }
  ```
- [x] Add constructor that accepts Synapse instance and options
- [x] Store provider info and create PDPServer instance

### Step 3: Implement Provider Selection Logic

- [x] In `StorageService.create()` static factory method:
  - [x] If `providerId` is provided:
    - Use `PandoraService.getApprovedProvider(providerId)`
    - Verify provider is approved (not zero address)
  - [x] If no `providerId`:
    - Use `PandoraService.getAllApprovedProviders()`
    - Implement random selection that works in all contexts:
      ```typescript
      const providers = await pandoraService.getAllApprovedProviders()
      if (providers.length === 0) {
        throw new Error('No approved storage providers available')
      }
      
      // Use multiple sources of randomness for better distribution
      // This works in both secure (HTTPS) and insecure (HTTP) contexts
      let randomIndex: number
      
      // Try crypto.getRandomValues if available (HTTPS contexts)
      if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues != null) {
        const randomBytes = new Uint8Array(1)
        globalThis.crypto.getRandomValues(randomBytes)
        randomIndex = randomBytes[0] % providers.length
      } else {
        // Fallback for HTTP contexts - use multiple entropy sources
        const timestamp = Date.now()
        const random = Math.random()
        // Use wallet address as additional entropy
        const addressBytes = await signer.getAddress()
        const addressSum = addressBytes.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
        
        // Combine sources for better distribution
        const combined = (timestamp * random * addressSum) % providers.length
        randomIndex = Math.floor(Math.abs(combined))
      }
      
      const selectedProvider = providers[randomIndex]
      ```
    - This ensures fair distribution across providers in all environments
- [x] Store selected provider info in instance
- [x] Create PDPServer instance with provider URLs

### Step 4: Implement Proof Set Selection/Creation

- [x] Add `selectOrCreateProofSet()` private static method:
  - [x] Query proof sets for the current wallet using `PandoraService.getClientProofSetsWithDetails()`
  - [x] Filter proof sets that belong to selected provider (match payee with provider owner)
  - [x] Selection logic:
    - Filter for live, managed proof sets with matching CDN preference
    - Prefer proof sets with existing roots (more efficient)
    - Sort by PDPVerifier proof set ID (older first)
    - Use first match
- [x] For proof set creation:
  - [x] Get next client dataset ID using `PandoraService.getNextClientDataSetId()`
  - [x] Use `PDPServer.createProofSet()` with parameters:
    - `clientDataSetId`: from getNextClientDataSetId()
    - `payee`: provider.owner (storage provider address)
    - `withCDN`: from options
    - `recordKeeper`: pandoraAddress (Pandora contract)
  - [x] Wait for creation using `PandoraService.waitForProofSetCreationWithStatus()`
  - [x] Return created proof set ID from summary

### Step 5: Implement Preflight Check

- [ ] Implement `preflightUpload(size: number)` method:
  - [ ] Use `PandoraService.calculateStorageCost(size)` for pricing
    - Note: Returns nested structure with `withCDN` and `withoutCDN` objects
    - Extract correct costs based on `this._withCDN` setting
  - [ ] Use `PandoraService.checkAllowanceForStorage()` for allowance check
    - Requires passing `this._synapse.payments` as parameter
    - Returns `AllowanceCheckResult` with `sufficient`, `required`, `current`, `message`
  - [ ] Return `PreflightInfo` with:
    - Cost estimates (perEpoch, perDay, perMonth from selected CDN option)
    - Allowance sufficiency status and message
    - Selected provider info
    - Selected proof set ID (this._proofSetId)

### Step 6: Implement Upload Method

- [ ] Create `upload(data: Uint8Array | ArrayBuffer, callbacks?: UploadCallbacks)`:
  - [ ] **Validation Phase**:
    - Check data size is <= 200 MiB (209,715,200 bytes)
    - Throw error with clear message if size exceeds limit
  - [ ] **Setup Phase**:
    - Call `callbacks?.onSetup()` with provider and proof set info
    - Note: Proof set already created in constructor, so needsNewProofSet is always false
  - [ ] **Upload Phase**:
    - Use `PDPServer.uploadPiece()` to upload data
    - Returns `{ commP: string, size: number }`
    - Poll `PDPServer.findPiece()` until piece is "parked" (status check)
    - Call `callbacks?.onUploadComplete()` with CommP
  - [ ] **Add Root Phase**:
    - Get add roots info using `PandoraService.getAddRootsInfo(proofSetId, clientAddress)`
      - **Critical**: Returns `nextRootId` which MUST match chain state
    - Create root data array: `[{ cid: commP, rawSize: size }]`
    - Use `PDPServer.addRoots()` with parameters:
      - `proofSetId`: PDPVerifier proof set ID (not rail ID!)
      - `clientDataSetId`: from getNextClientDataSetId()
      - `nextRootId`: from getAddRootsInfo() to avoid signature validation failures
      - `rootDataArray`: array with CommP and size
    - Call `callbacks?.onRootAdded()`
  - [ ] Return `UploadResult` with CommP, size, and optionally rootId for tracking

### Step 7: Implement Download Method

- [ ] Implement `download(commp: string | CommP, options?: DownloadOptions)`:
  - [ ] Use `PDPServer.downloadPiece()` for retrieval
  - [ ] Handle CDN vs direct download based on options and instance setting
  - [ ] Return downloaded data as Uint8Array
  - [ ] Note: PDPServer already handles CommP verification

### Step 8: Implement Supporting Methods

- [ ] Implement `delete(commp: string | CommP)`:
  - [ ] Use proof set removal operations (schedule removal)
  - [ ] Note: This needs the root ID, not just CommP
  - [ ] May need to track root IDs during upload
- [ ] Implement `settlePayments()`:
  - [ ] Query payment rail for the proof set
  - [ ] Use PaymentsService to settle the rail
  - [ ] Return settlement info

### Step 9: Update Synapse.createStorage()

- [ ] Modify `src/synapse.ts`:
  - [ ] Replace mock storage service with real implementation
  - [ ] Pass necessary dependencies (provider, signer, etc.)
  - [ ] Handle initialization errors gracefully

### Step 10: Comprehensive Testing

- [ ] **Unit Tests** (`src/test/storage-service.test.ts`):
  - [ ] Provider selection logic (with/without providerId)
  - [ ] Proof set selection algorithm
  - [ ] Upload size validation (200 MiB limit)
  - [ ] Preflight calculations
  - [ ] Error handling for each phase
  - [ ] Mock PDPServer and PandoraService interactions

- [ ] **Integration Tests** (`src/test/storage-integration.test.ts`):
  - [ ] Complete upload/download cycle with real contracts (testnet)
  - [ ] Provider not found scenarios
  - [ ] Insufficient allowance handling
  - [ ] Network failure recovery
  - [ ] Concurrent upload handling
  - [ ] Large file (near 200 MiB) upload/download

- [ ] **Manual Testing Checklist**:
  - [ ] Test with MetaMask wallet
  - [ ] Test with different storage providers
  - [ ] Test creating new proof sets vs using existing
  - [ ] Test CDN vs direct download
  - [ ] Test error recovery scenarios

- [ ] **Documentation Updates**:
  - [ ] Update example-usage.js with callback examples
  - [ ] Add storage-specific examples
  - [ ] Document size limitations clearly
  - [ ] Add troubleshooting guide
  - [ ] Update API documentation with JSDoc

## Technical Considerations

### PDPServer Method Signatures and Parameters

Based on the actual implementation:

1. **createProofSet** parameters:
   - `clientDataSetId: number` - Sequential ID for client's dataset
   - `payee: string` - Storage provider address (who receives payments)
   - `withCDN: boolean` - Enable CDN services
   - `recordKeeper: string` - Pandora contract address
   - Returns: `{ txHash: string, statusUrl: string }`

2. **addRoots** parameters:
   - `proofSetId: number` - PDPVerifier proof set ID (not rail ID)
   - `clientDataSetId: number` - Same as used in createProofSet
   - `nextRootId: number` - Must match chain state or signature fails
   - `rootDataArray: RootData[]` - Array of `{ cid: string | CommP, rawSize: number }`
   - Returns: `{ message: string }`

3. **uploadPiece** parameters:
   - `data: Uint8Array | ArrayBuffer` - Raw file data
   - `name?: string` - Optional filename (defaults to 'piece.dat')
   - Returns: `{ commP: string, size: number }`

4. **downloadPiece** parameters:
   - `commP: string | CommP` - Piece identifier
   - Returns: `Uint8Array` - Downloaded data (already verified)

### PandoraService Key Methods

1. **calculateStorageCost** returns:
   ```typescript
   {
     perEpoch: bigint,
     perDay: bigint,
     perMonth: bigint,
     withCDN: {
       perEpoch: bigint,
       perDay: bigint,
       perMonth: bigint
     }
   }
   ```

2. **checkAllowanceForStorage** parameters:
   - `sizeInBytes: number`
   - `withCDN: boolean`
   - `paymentsService: PaymentsService`
   - Returns detailed allowance requirements and sufficiency

3. **getAddRootsInfo** returns:
   - `nextRootId: number` - Critical for signature validation
   - `clientDataSetId: number`
   - `currentRootCount: number`

### Size Limitations
- **Current limit**: 200 MiB (209,715,200 bytes) per upload
- Enforce in upload method with clear error message
- Future versions will support larger files with chunking

### Polling Strategy
- For `findPiece`: Poll every 2 seconds, timeout after 60 seconds
- For proof set creation: Use existing polling in PandoraService (default 2s intervals)

### Error Handling
- Data size exceeds 200 MiB limit
- Provider not found/not approved
- Insufficient allowances
- Upload failures (network, server errors)
- Piece not found during polling
- Transaction failures
- Invalid nextRootId causing signature validation failure

### State Management
- Track uploaded pieces with their root IDs for deletion
- StorageService is immutable after creation (provider and proof set fixed)
- Handle concurrent uploads to same proof set

### Implementation Details

1. **Factory Pattern**: Use static `create()` method for async initialization
2. **Immutable Service**: Once created, provider and proof set don't change
3. **PDPAuthHelper**: Created with Pandora address (not PDPVerifier)
4. **Proof Set IDs**: Be careful to distinguish between:
   - Rail ID (Pandora payment rail)
   - PDPVerifier proof set ID (global identifier)
5. **Provider URLs**: Both pdpUrl and pieceRetrievalUrl needed

### Future Enhancements (Post-MVP)
- Remove 200 MiB limit with chunking support
- Multiple provider selection strategies (e.g., by geographic location, performance metrics)
- Proof set rotation/management
- Upload resume capability
- Batch upload support
- Progress tracking for large files
- Provider health monitoring and automatic failover

## Notes

- The current limitation is that Curio doesn't return transaction hashes for add roots operations (see https://github.com/filecoin-project/curio/issues/520)
- CDN support depends on proof set configuration at creation time
- Provider URLs must be valid and accessible for successful operations
- MetaMask signing handled automatically by PDPAuthHelper

## Key Components Reference

### Existing Classes to Use
- `PandoraService` (src/pandora/service.ts) - Provider management, proof set queries, cost calculations
- `PDPServer` (src/pdp/server.ts) - HTTP API for uploads, downloads, proof set operations
- `PDPAuthHelper` (src/pdp/auth.ts) - EIP-712 signature generation
- `PaymentsService` (src/payments/service.ts) - Balance and allowance checks

### Key Methods by Component

**PandoraService:**
- `getAllApprovedProviders()` - Get list of approved storage providers
- `getApprovedProvider(id)` - Get specific provider info
- `getClientProofSetsWithDetails()` - Get enhanced proof set information with PDPVerifier IDs
- `getNextClientDataSetId()` - Get next dataset ID for new proof sets
- `calculateStorageCost()` - Calculate storage pricing with/without CDN
- `checkAllowanceForStorage()` - Check payment allowances with detailed requirements
- `waitForProofSetCreationWithStatus()` - Wait for proof set creation with comprehensive status
- `getAddRootsInfo()` - Get nextRootId and clientDataSetId for adding roots

**PDPServer:**
- `createProofSet(clientDataSetId, payee, withCDN, recordKeeper)` - Create new proof set
- `uploadPiece(data, name?)` - Upload data and get CommP
- `findPiece(commP, size)` - Check if piece is ready
- `addRoots(proofSetId, clientDataSetId, nextRootId, rootDataArray)` - Add CommP to proof set
- `downloadPiece(commP)` - Download and verify piece

**Example Files:**
- `utils/pdp-tool-test.html` - Complete proof set creation flow with MetaMask integration
- `utils/proof-sets-viewer.html` - Proof set querying examples
- `utils/storage-provider-tool.html` - Provider management examples

### Critical Implementation Notes from Examples

From `pdp-tool-test.html`:
1. **Proof Set Discovery**: Use `getClientProofSetsWithDetails()` and filter for managed proof sets
2. **Auto-fill Pattern**: Provide buttons to auto-fill IDs from chain state
3. **Comprehensive Status**: Use `getComprehensiveProofSetStatus()` for detailed feedback
4. **ID Distinction**: Always use PDPVerifier proof set ID for operations, not rail ID

## Example Demo Script

Create `examples/upload-file.js` to demonstrate the complete storage flow:

```javascript
#!/usr/bin/env node

import { Synapse, TOKENS } from '../dist/index.js'
import { readFile } from 'fs/promises'
import { resolve } from 'path'

async function main() {
  // Configuration from environment
  const privateKey = process.env.PRIVATE_KEY
  const filePath = process.env.FILE_PATH || process.argv[2]
  const network = process.env.NETWORK || 'calibration'
  const providerId = process.env.PROVIDER_ID ? parseInt(process.env.PROVIDER_ID) : undefined
  
  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable is required')
    process.exit(1)
  }
  
  if (!filePath) {
    console.error('Error: FILE_PATH environment variable or argument is required')
    console.error('Usage: PRIVATE_KEY=0x... FILE_PATH=./myfile.dat node upload-file.js')
    console.error('   or: PRIVATE_KEY=0x... node upload-file.js ./myfile.dat')
    process.exit(1)
  }

  console.log('🚀 Synapse Storage Upload Demo')
  console.log('==============================')
  console.log(`Network: ${network}`)
  console.log(`File: ${filePath}`)
  
  try {
    // Read file
    const data = await readFile(resolve(filePath))
    const sizeMB = (data.length / (1024 * 1024)).toFixed(2)
    console.log(`File size: ${sizeMB} MB (${data.length} bytes)`)
    
    if (data.length > 209715200) {
      console.error('Error: File size exceeds 200 MiB limit')
      process.exit(1)
    }
    
    // Initialize SDK
    console.log('\n📦 Initializing Synapse SDK...')
    const synapse = await Synapse.create({
      privateKey,
      rpcURL: network === 'mainnet' 
        ? 'https://api.node.glif.io/rpc/v1'
        : 'https://api.calibration.node.glif.io/rpc/v1'
    })
    
    const address = await synapse.payments._signer.getAddress()
    console.log(`Wallet address: ${address}`)
    
    // Check balance
    const balance = await synapse.payments.balance(TOKENS.USDFC)
    const balanceFormatted = (Number(balance) / 1e18).toFixed(4)
    console.log(`USDFC balance in Payments: ${balanceFormatted} USDFC`)
    
    // Create storage service
    console.log('\n🔍 Setting up storage service...')
    const storage = await synapse.createStorage({ 
      providerId,
      withCDN: false 
    })
    
    // Preflight check
    console.log('\n💰 Running preflight checks...')
    const preflight = await storage.preflightUpload(data.length)
    console.log(`Estimated cost per month: ${(Number(preflight.estimatedCost.perMonth) / 1e18).toFixed(6)} USDFC`)
    console.log(`Selected provider: ${preflight.selectedProvider.owner}`)
    console.log(`  PDP URL: ${preflight.selectedProvider.pdpUrl}`)
    console.log(`Selected proof set: ${preflight.selectedProofSetId}`)
    
    if (!preflight.allowanceCheck.sufficient) {
      console.error(`\n❌ Insufficient allowances: ${preflight.allowanceCheck.message}`)
      console.log('\nPlease approve the service with sufficient allowances first.')
      process.exit(1)
    }
    
    // Upload with progress callbacks
    console.log('\n📤 Starting upload...')
    const result = await storage.upload(data, {
      onSetup: (status) => {
        console.log(`✓ Setup complete: Provider ${status.provider.owner.slice(0, 10)}...`)
        if (status.needsNewProofSet) {
          console.log('  Creating new proof set...')
        } else {
          console.log(`  Using existing proof set: ${status.proofSetId}`)
        }
      },
      
      onProofSetCreated: (id, txn) => {
        console.log(`✓ Proof set created: ID ${id}`)
        console.log(`  Transaction: ${txn}`)
      },
      
      onUploadComplete: (commp) => {
        console.log(`✓ Upload complete: CommP ${commp}`)
      },
      
      onRootAdded: () => {
        console.log('✓ Root added to proof set')
      }
    })
    
    console.log('\n✅ Upload successful!')
    console.log(`CommP: ${result.commp}`)
    console.log(`Proof Set ID: ${storage.proofSetId}`)
    
    // Verify by downloading
    console.log('\n📥 Verifying upload by downloading...')
    const downloaded = await storage.download(result.commp)
    const matches = Buffer.compare(data, downloaded) === 0
    console.log(`✓ Download verification: ${matches ? 'PASSED' : 'FAILED'}`)
    
    if (matches) {
      console.log('\n🎉 Success! File uploaded and verified.')
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

// Run the demo
main().catch(console.error)
```

### Running the Demo Script

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Run with environment variables
PRIVATE_KEY=0xYourPrivateKey FILE_PATH=./test-file.dat node examples/upload-file.js

# Or with optional parameters
PRIVATE_KEY=0xYourPrivateKey NETWORK=calibration PROVIDER_ID=1 node examples/upload-file.js ./test-file.dat
```

### Demo Script Features

1. **Environment Configuration**: Accepts private key, file path, network, and optional provider ID
2. **Size Validation**: Checks the 200 MiB limit before attempting upload
3. **Balance Check**: Shows current USDFC balance in payments contract
4. **Preflight Info**: Displays estimated costs and selected provider/proof set
5. **Progress Callbacks**: Shows each phase of the upload process
6. **Verification**: Downloads the file to verify successful storage
7. **Error Handling**: Clear error messages for common issues

This script serves as both a testing tool and documentation of the expected API usage.