# Performance Analysis and Timing

The Synapse SDK uses the standard Performance API to collect timing data for analysis and optimization of storage operations. All timing data in this document is based on 100 MiB piece uploads unless otherwise specified.

## Overview

The SDK strategically places performance marks throughout key operations, allowing external tools to observe and analyze performance without any overhead in production use. This approach uses the Web Performance API that's available in all modern JavaScript runtimes.

## Timing Collection Points

The SDK measures the following operations (all prefixed with `synapse:` to avoid collisions):

### createDataSet() Timing Points

- `synapse:createDataSet` - Overall data set creation time
- `synapse:pdpServer.createDataSet` - Server response time for data set creation
- `synapse:getTransaction` - Time to retrieve transaction from blockchain
- `synapse:waitForDataSetCreationWithStatus` - Overall wait time for completion
- `synapse:pdpServer.getDataSetCreationStatus` - Server acknowledgment time
- `synapse:verifyDataSetCreation` - Data set liveness verification time

### upload() Timing Points

- `synapse:upload` - Overall upload operation time
- `synapse:calculatePieceCID` - PieceCID calculation time
- `synapse:POST.pdp.piece` - Piece upload initiation time
- `synapse:PUT.pdp.piece.upload` - Piece upload completion time
- `synapse:findPiece` - Time for piece to be "parked" (ready)
- `synapse:pdpServer.addPieces` - Server processing time for adding pieces
- `synapse:getTransaction.addPieces` - Transaction retrieval for piece addition
- `synapse:transaction.wait` - Transaction confirmation time
- `synapse:getPieceAdditionStatus` - Verified pieces confirmation time

## Using Performance Data

### In JavaScript Applications

```javascript
import { Synapse } from '@filoz/synapse-sdk'

// Set up observer before using SDK
const obs = new PerformanceObserver((items) => {
  items.getEntries().forEach((entry) => {
    // Filter for synapse SDK measurements
    if (entry.name.startsWith('synapse:')) {
      console.log(`${entry.name}: ${entry.duration}ms`)
    }
  })
})

obs.observe({ entryTypes: ['measure'] })

// Use SDK normally - measurements happen automatically
const synapse = await Synapse.create({ ... })
const storage = await synapse.createStorage()
await storage.upload(data)
```

### In Browser DevTools

Performance marks and measures automatically appear in Chrome DevTools Performance tab:

1. Open DevTools (F12)
2. Go to Performance tab
3. Start recording
4. Run your SDK operations
5. Stop recording
6. Look for "User Timing" section to see all SDK measurements

### Benchmark Tool

A comprehensive benchmark tool is available in `utils/benchmark.js`:

```bash
# Build the SDK first
pnpm run build

# Run benchmark with your private key
PRIVATE_KEY=0x... RPC_URL=https://api.calibration.node.glif.io/rpc/v1 node utils/benchmark.js
```

The benchmark:

- Runs 4 iterations of data set creation + 4 unique piece uploads (100 MiB each)
- Collects all timing measurements
- Provides statistical analysis (min, max, average)
- Uses PerformanceObserver to capture SDK timing data

## Performance Characteristics

### Typical Timing Ranges (Calibration Testnet, 100 MiB pieces)

- **PieceCID Calculation**: 2-8 seconds (CPU-dependent)
- **Data Set Creation**: 30-75 seconds total
  - Server response: 1-8 seconds
  - Transaction confirmation: 20-65 seconds (varies with block cycle timing)
  - Server acknowledgment: 0.5-60 seconds (highly variable due to block timing)
- **Upload Operations**: 45-150+ seconds total (for 100 MiB pieces)
  - Piece upload: Highly variable (see note below)
  - Piece parking: ~7 seconds (size-independent)
  - Piece addition: 20-70 seconds (includes transaction confirmation)
  - Verification: 1-30 seconds (varies with block cycle position)

**Note on Timing Variance**: Operations that wait for blockchain confirmation show high variance due to Filecoin's 30-second block time. If a transaction is submitted just before a new block, confirmation can be very fast (~1 second). If submitted just after a block, you must wait nearly the full 30 seconds for the next block. This explains why operations like `verifyDataSetCreation` and `getPieceAdditionStatus` can range from under 1 second to 60+ seconds.

**Piece Upload Timing**: Upload times are highly dependent on multiple factors:

- **Upload bandwidth**: 100 MiB at 50 Mbps ≈ 16 seconds (theoretical), but real-world is 30-45 seconds with overhead
- **Upload bandwidth**: 100 MiB at 1 Gbps ≈ 1 second (theoretical), likely 5-10 seconds real-world
- **Server performance**: Service provider server specs significantly impact processing time
- **Geographic distance**: Latency and routing affect throughput
- **Piece size**: Larger pieces scale linearly with bandwidth constraints

**Scaling with Piece Size**: The timing data above is for 100 MiB pieces. For different piece sizes:

- **PieceCID calculation**: Scales linearly (e.g., 1 GiB ≈ 20-80 seconds)
- **Piece upload**: Scales linearly with size and bandwidth constraints
- **Other operations**: Generally size-independent (transaction confirmations, server acknowledgments)

**Geographic Impact**: The timing ranges above reflect real-world usage across different geographic regions. Same-region deployments (client and service provider in the same data center or region) will see times at the lower end of these ranges, while international usage will approach the upper bounds.

### Understanding Wait Times

Most operation time is spent waiting for:

1. **Blockchain Confirmations** - Transaction finality (largest component, Filecoin's block time is 30 seconds)
2. **Server Processing** - Service provider internal operations
3. **Network Propagation** - RPC node synchronization
4. **PieceCID Calculation** - CPU-intensive custom hash function required on the client side to validate upload (scales linearly with piece size)
