#!/usr/bin/env node

import { Synapse } from './dist/synapse.js'
import { timingCollector } from './dist/utils/timing.js'
import { enableTimingCollection } from './dist/utils/timing.js'

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const PROVIDER_ADDRESS = process.env.PROVIDER_ADDRESS
const PIECE_SIZE = 100 * 1024 * 1024 // 100 MiB
const NUM_RUNS = 4
const PANDORA_ADDRESS = process.env.PANDORA_ADDRESS;

if (!PRIVATE_KEY) {
  console.error('Please set PRIVATE_KEY environment variable')
  process.exit(1)
}

enableTimingCollection()

async function generateRandomData(size) {
  const data = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    data[i] = Math.floor(Math.random() * 256)
  }
  return data
}

async function runBenchmark() {
  console.log('Starting Synapse SDK Benchmark')
  console.log(`Provider: ${PROVIDER_ADDRESS}`)
  console.log(`Piece size: ${PIECE_SIZE / (1024 * 1024)} MiB`)
  console.log(`Number of runs: ${NUM_RUNS}`)
  console.log('')

  // Initialize Synapse
  const synapse = await Synapse.create({
    privateKey: PRIVATE_KEY,
    rpcURL: RPC_URL,
    pandoraAddress: PANDORA_ADDRESS
  })
  console.log('Synapse instance:', synapse)
  console.log('Synapse network:', synapse.getNetwork && synapse.getNetwork())

  try {
    for (let run = 1; run <= NUM_RUNS; run++) {
      console.log(`\n=== Run ${run}/${NUM_RUNS} ===`)
      
      // Create new proof set
      console.log('Creating new proof set...')
      const storage = await synapse.createStorage({
        providerAddress: PROVIDER_ADDRESS,
        newProofSet: true,
        withCDN: false
      })
      
      console.log(`Proof set created: ${storage.proofSetId}`)
      
      // Upload 4 unique pieces
      for (let piece = 1; piece <= 4; piece++) {
        console.log(`Uploading piece ${piece}/4...`)
        const data = await generateRandomData(PIECE_SIZE)
        
        const result = await storage.upload(data)
        console.log(`Piece uploaded: ${result.commp}`)
      }
      
      // Print timing results for this run
      console.log('\nTiming results for this run:')
      timingCollector.printResults()
      
      // Clear timings for next run
      timingCollector.clear()
    }
    
    console.log('\n=== BENCHMARK COMPLETE ===')
    
  } catch (error) {
    console.error('Benchmark failed:', error)
    process.exit(1)
  }
}

runBenchmark().catch(console.error) 