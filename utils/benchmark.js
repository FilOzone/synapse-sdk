#!/usr/bin/env node

import { SIZE_CONSTANTS, Synapse } from '../packages/synapse-sdk/src/index.ts'

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY
const RPC_URL = process.env.RPC_URL || 'https://api.calibration.node.glif.io/rpc/v1'
const PROVIDER_ADDRESS = process.env.PROVIDER_ADDRESS
const PIECE_SIZE = Number(100n * SIZE_CONSTANTS.MiB) // 100 MiB
const NUM_RUNS = 4
const PANDORA_ADDRESS = process.env.PANDORA_ADDRESS

if (!PRIVATE_KEY) {
  console.error('Please set PRIVATE_KEY environment variable')
  process.exit(1)
}

// Set up performance timing collection
const timings = new Map()

const obs = new PerformanceObserver((items) => {
  items.getEntries().forEach((entry) => {
    if (!timings.has(entry.name)) {
      timings.set(entry.name, [])
    }
    timings.get(entry.name).push({
      duration: entry.duration,
      startTime: entry.startTime,
    })
  })
})

obs.observe({ entryTypes: ['measure'] })

function printTimingResults() {
  console.log('\n=== TIMING RESULTS ===')

  const sortedTimings = Array.from(timings.entries()).sort(([a], [b]) => a.localeCompare(b))

  for (const [name, measurements] of sortedTimings) {
    console.log(`\n${name}:`)
    measurements.forEach((timing, index) => {
      console.log(`  ${index + 1}. ${timing.duration.toFixed(2)}ms`)
    })

    if (measurements.length > 1) {
      const durations = measurements.map((m) => m.duration)
      const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length
      const min = Math.min(...durations)
      const max = Math.max(...durations)
      console.log(`  Average: ${avg.toFixed(2)}ms, Min: ${min.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`)
    }
  }

  console.log('\n=====================\n')
}

function clearTimings() {
  timings.clear()
}

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
  console.log(`Piece size: ${PIECE_SIZE / Number(SIZE_CONSTANTS.MiB)} MiB`)
  console.log(`Number of runs: ${NUM_RUNS}`)
  console.log('')

  // Initialize Synapse
  const synapse = await Synapse.create({
    privateKey: PRIVATE_KEY,
    rpcURL: RPC_URL,
    warmStorageAddress: PANDORA_ADDRESS,
  })
  console.log('Synapse instance:', synapse)
  console.log('Synapse network:', synapse.getNetwork?.())

  try {
    for (let run = 1; run <= NUM_RUNS; run++) {
      console.log(`\n=== Run ${run}/${NUM_RUNS} ===`)

      // Create new data set
      console.log('Creating new data set...')
      const storageContext = await synapse.storage.createContext({
        providerAddress: PROVIDER_ADDRESS,
        forceCreateDataSet: true,
        withCDN: false,
      })

      console.log(`Data set created: ${storageContext.dataSetId}`)

      // Upload 4 unique pieces
      for (let piece = 1; piece <= 4; piece++) {
        console.log(`Uploading piece ${piece}/4...`)
        const data = await generateRandomData(PIECE_SIZE)

        const result = await storageContext.upload(data)
        console.log(`Piece uploaded: ${result.pieceCid}`)
      }

      // Print timing results for this run
      console.log('\nTiming results for this run:')
      printTimingResults()

      // Clear timings for next run
      clearTimings()
    }

    console.log('\n=== BENCHMARK COMPLETE ===')
  } catch (error) {
    console.error('Benchmark failed:', error)
    process.exit(1)
  }
}

runBenchmark().catch(console.error)
