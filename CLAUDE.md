# Synapse SDK Context File

This document serves as context for LLM agent sessions working with the Synapse SDK. It will be updated as development progresses.

## Overview

The Synapse SDK (synapse.js) provides a JavaScript interface to Filecoin Synapse. Synapse is a smart-contract based marketplace for services in the Filecoin ecosystem, with a primary focus on storage services.

Synapse.js allows users to interact with Filecoin services using HTTP or WebSocket connections.

## Key Components

1. **Synapse**: The main entry point for the SDK, handling blockchain interactions, wallet management, payment operations, and service creation.

2. **Services**:
   - **Storage Service**: Built on PDP (Proof of Data Possession), enabling data storage with verifiability and availability guarantees.
   - Future services may include PoRep-based archiving and other Filecoin ecosystem services.

3. **Content Abstractions**:
   - **ContentSource**: Represents a file or content blob with metadata
   - **DirectorySource**: Represents a directory structure containing multiple files/directories
   - These abstractions allow the SDK to be environment-agnostic

4. **Protocols & Contracts**:
   - **PDP Verifier**: The main contract that holds proof sets and verifies proofs
   - **SimplePDPService**: Manages proving periods and fault reporting
   - **Verifier Contracts**: Verify that services are being properly offered
   - **SLA Contracts**: Define market terms of agreements between clients and service providers

## PDP Workflow

1. Clients and providers establish a proof set for data storage verification
2. Providers add data roots to the proof set and submit periodic proofs
3. The system verifies these proofs using randomized challenges based on chain randomness
4. Faults are reported when proofs fail or are not submitted

## Architecture

The SDK follows a modular design with:
- A core `Synapse` class for blockchain interactions and payment operations
- Factory methods for creating service-specific modules
- Service classes that encapsulate specific functionality like storage
- Environment-agnostic content abstractions with adapter patterns
- Optional adapter libraries for different environments

## Usage Pattern

```typescript
// Initialize Synapse instance
const synapse = new Synapse({
  rpcUrl: "wss://wss.node.glif.io/apigw/lotus/rpc/v1",
  privateKey: "0x...", // For signing transactions
})

// Create a storage service instance
const storage = synapse.createStorage({
  duration: 90, // days
  replicas: 3,
  retrievalCheck: 2
})

// Node.js example - using an adapter
const { NodeAdapters } = require('synapse-sdk-node')
const content = await NodeAdapters.fileToContent('/path/to/file.txt')
const cid = await storage.upload(content)

// Browser example - using an adapter
import { BrowserAdapters } from 'synapse-sdk-browser'
const fileInput = document.getElementById('fileInput')
const file = fileInput.files[0]
const content = BrowserAdapters.fileToContent(file)
const cid = await storage.upload(content)

// Universal example - raw bytes
const bytes = new Uint8Array([...])
const cid = await storage.uploadBytes(bytes, 'filename.txt')

// Downloading content
const content = await storage.download(cid)
// In Node.js
await NodeAdapters.contentToFile(content, '/path/to/save.txt')
// In browser
await BrowserAdapters.contentToDownload(content)

// Payments
await synapse.paymentDeposit(amount)
await synapse.paymentWithdraw(amount)
```

## Design Decisions

1. **Core API Design**:
   - Constructor pattern with options objects for clean initialization
   - Factory methods for creating service instances (`synapse.createStorage()`)
   - Payment methods directly on the Synapse instance with a `payment` prefix

2. **Environment Agnosticism**:
   - Core SDK has no dependencies on environment-specific APIs (Node.js/Browser)
   - Content and directory abstractions provide a unified interface
   - Adapter pattern for connecting to environment-specific file handling

3. **UnixFS Support**:
   - Content abstractions designed to preserve metadata needed for UnixFS
   - Directory structures maintained for proper IPFS packing
   - Support for both single files and directory trees

4. **Storage Service Design**:
   - Clean separation between content handling and storage operations
   - Upload methods accept abstract content sources
   - Download methods return abstract content sources
   - Status checking methods for different aspects (availability, retrievability)

5. **TypeScript Styling**:
   - No semicolons (following modern JavaScript style)
   - Compact type definitions
   - Comprehensive exports for all public interfaces

## Implementation Notes

The SDK is designed to work in both Node.js and browser environments, with adapters handling environment-specific functionality. The core SDK itself remains environment-agnostic through the content abstractions.

Adapter implementations (not part of core) provide:
- Node.js: Filesystem interactions, stream support
- Browser: File/Blob API, download triggers, File System Access API
- Universal: Web streams, network requests, memory operations

This document will be updated as the SDK design evolves.