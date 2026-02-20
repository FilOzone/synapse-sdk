#!/usr/bin/env node

/*
 * Runner: generate test files and invoke example-storage-e2e.js for multiple sizes
 *
 * Usage:
 *   node utils/example-storage-e2e-runner.js          # runs default sizes (10MB, 500MB)
 *   node utils/example-storage-e2e-runner.js 10MB 500MB
 *
 * Environment:
 * - NETWORK: "mainnet" | "calibnet" | "devnet" (default: "devnet")
 * - PRIVATE_KEY: Wallet private key (auto-loaded from devnet-info.json on devnet)
 * - DEVNET_INFO_PATH / DEVNET_USER_INDEX: Devnet user override
 * - SKIP_SETUP=1: Skip automatic deposit/allowance setup
 * - CLEANUP=1: Remove generated files after each run
 * - DEPOSIT_AMOUNT: USDFC deposit amount in whole units (default: 100)
 *
 * Notes:
 * - The runner streams random data to disk (avoids allocating large buffers in memory).
 * - Before each e2e run it deposits USDFC and approves WarmStorage operator allowances
 *   using the SDK directly (no ethers dependency).
 */

import { createWriteStream, readFileSync, unlinkSync } from 'fs'
import fsPromises from 'fs/promises'
import { randomFillSync } from 'crypto'
import { spawnSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

import { createPublicClient, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration, mainnet } from '../packages/synapse-core/src/chains.ts'
import { Synapse } from '../packages/synapse-sdk/src/index.ts'

const DEFAULT_SIZES = ['10MB', '500MB']

function parseSize(spec) {
  if (typeof spec === 'number') return spec
  const m = String(spec).toUpperCase().trim()
  if (m.endsWith('MB')) return Number(m.slice(0, -2)) * 1024 * 1024
  if (m.endsWith('M')) return Number(m.slice(0, -1)) * 1024 * 1024
  if (m.endsWith('KB')) return Number(m.slice(0, -2)) * 1024
  if (m.endsWith('K')) return Number(m.slice(0, -1)) * 1024
  return Number(m)
}

async function createRandomFile(filePath, size) {
  const CHUNK = 1024 * 1024 // 1MB
  const stream = createWriteStream(filePath)
  let remaining = size
  const buffer = Buffer.alloc(CHUNK)

  return new Promise((resolve, reject) => {
    function writeNext() {
      if (remaining <= 0) {
        stream.end()
        return
      }
      const toWrite = Math.min(remaining, CHUNK)
      randomFillSync(buffer, 0, toWrite)
      const ok = stream.write(buffer.subarray(0, toWrite))
      remaining -= toWrite
      if (!ok) {
        stream.once('drain', writeNext)
      } else {
        // schedule next tick to avoid blocking
        setImmediate(writeNext)
      }
    }

    stream.on('finish', () => resolve())
    stream.on('error', (err) => reject(err))
    writeNext()
  })
}

function human(size) {
  const k = 1024
  if (size < k) return `${size} B`
  if (size < k * k) return `${(size / k).toFixed(2)} KB`
  if (size < k * k * k) return `${(size / k / k).toFixed(2)} MB`
  return `${(size / k / k / k).toFixed(2)} GB`
}

/**
 * Resolve chain + private key, reusing the same devnet logic as example-storage-e2e.js
 */
async function resolveChainAndKey() {
  const NETWORK = process.env.NETWORK || 'devnet'
  const RPC_URL = process.env.RPC_URL
  let privateKey = process.env.PRIVATE_KEY
  let chain

  if (NETWORK === 'devnet') {
    const { validateDevnetInfo, toChain } = await import('../packages/synapse-core/src/devnet/index.ts')
    const devnetInfoPath =
      process.env.DEVNET_INFO_PATH || join(homedir(), '.foc-devnet', 'state', 'latest', 'devnet-info.json')
    const userIndex = Number(process.env.DEVNET_USER_INDEX || '0')

    console.log(`Loading devnet info from: ${devnetInfoPath}`)
    const rawData = JSON.parse(readFileSync(devnetInfoPath, 'utf8'))
    const devnetInfo = validateDevnetInfo(rawData)
    const { info } = devnetInfo

    if (userIndex >= info.users.length) {
      console.error(`DEVNET_USER_INDEX=${userIndex} out of range (${info.users.length} users)`)
      process.exit(1)
    }

    const user = info.users[userIndex]
    if (!privateKey) privateKey = user.private_key_hex

    chain = toChain(devnetInfo)
    if (RPC_URL) chain = { ...chain, rpcUrls: { ...chain.rpcUrls, default: { http: [RPC_URL] } } }

    console.log(`Devnet run: ${info.run_id}, user: ${user.name} (${user.evm_addr})`)
  } else {
    const baseChain = NETWORK === 'mainnet' ? mainnet : calibration
    chain = RPC_URL ? { ...baseChain, rpcUrls: { ...baseChain.rpcUrls, default: { http: [RPC_URL] } } } : baseChain
  }

  if (!privateKey) {
    console.error('PRIVATE_KEY is required (or use NETWORK=devnet)')
    process.exit(1)
  }

  return { chain, privateKey }
}

/**
 * Ensure the wallet has USDFC deposited and WarmStorage operator approved.
 */
async function ensureAllowances(chain, privateKey) {
  const account = privateKeyToAccount(privateKey)
  const synapse = Synapse.create({ chain, transport: viemHttp(), account })

  const depositAmount = BigInt(process.env.DEPOSIT_AMOUNT || '100') * 10n ** 18n

  // Check current state
  const usdfcBalance = await synapse.payments.walletBalance({ token: 'USDFC' })
  const depositBalance = await synapse.payments.balance({ token: 'USDFC' })
  const approval = await synapse.payments.serviceApproval()

  console.log(`  Wallet USDFC: ${fmt(usdfcBalance)}, Deposited: ${fmt(depositBalance)}`)
  console.log(`  Operator approved: ${approval.isApproved}, rate: ${fmt(approval.rateAllowance)}, lockup: ${fmt(approval.lockupAllowance)}`)

  // If already approved with some deposit, skip
  if (approval.isApproved && depositBalance > 0n) {
    console.log('  Allowances already configured — skipping setup')
    return
  }

  if (usdfcBalance === 0n) {
    console.error('  Wallet has 0 USDFC — cannot deposit')
    process.exit(1)
  }

  const amount = depositAmount > usdfcBalance ? usdfcBalance : depositAmount

  // Create a public client to wait for tx receipts
  const publicClient = createPublicClient({ chain, transport: viemHttp() })

  // Deposit (uses asChain which preserves dynamic devnet addresses)
  if (depositBalance === 0n) {
    console.log(`  Depositing ${fmt(amount)}...`)
    const depositTx = await synapse.payments.deposit({ amount })
    console.log(`  Deposit tx: ${depositTx}`)
    console.log('  Waiting for deposit confirmation...')
    await publicClient.waitForTransactionReceipt({ hash: depositTx })
    console.log('  Deposit confirmed')
  }

  // Approve WarmStorage operator (separate call for devnet compat)
  if (!approval.isApproved) {
    console.log('  Approving WarmStorage operator...')
    const approveTx = await synapse.payments.approveService()
    console.log(`  Approve tx: ${approveTx}`)
    console.log('  Waiting for approval confirmation...')
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    console.log('  Approval confirmed')
  }
}

function fmt(wei) {
  return `${(Number(wei) / 1e18).toFixed(6)} USDFC`
}

async function run() {
  const args = process.argv.slice(2)
  const specs = args.length ? args : DEFAULT_SIZES
  const sizes = specs.map(parseSize)

  console.log('Runner will test sizes:', specs.join(', '))
  console.log('Using NETWORK:', process.env.NETWORK || 'devnet')

  // Resolve chain + key once
  const { chain, privateKey } = await resolveChainAndKey()

  // Ensure allowances before any uploads
  if (!process.env.SKIP_SETUP) {
    console.log('\n--- Client Setup (deposit + operator approval) ---')
    await ensureAllowances(chain, privateKey)
  }

  const cleanup = !!process.env.CLEANUP

  for (const [i, size] of sizes.entries()) {
    const fileName = `syn-e2e-${size}-${Date.now()}.bin`
    const filePath = join(process.cwd(), 'tmp', fileName)

    // ensure tmp directory exists
    await fsPromises.mkdir(join(process.cwd(), 'tmp'), { recursive: true })

    console.log(`\n[${i + 1}/${sizes.length}] Generating ${human(size)} -> ${filePath}`)
    await createRandomFile(filePath, size)
    const stat = await fsPromises.stat(filePath)
    console.log(`Created file: ${filePath} (${human(stat.size)})`)

    console.log('Invoking example-storage-e2e.js')
    const env = { ...process.env, NETWORK: process.env.NETWORK || 'devnet' }
    const res = spawnSync('node', ['utils/example-storage-e2e.js', filePath], {
      stdio: 'inherit',
      env,
    })

    if (res.error) {
      console.error('Failed to run example-storage-e2e.js', res.error)
    }
    if (res.status !== 0) {
      console.error(`example-storage-e2e.js exited with code ${res.status}`)
      if (cleanup) unlinkSync(filePath)
      process.exit(res.status || 1)
    }

    if (cleanup) {
      try {
        unlinkSync(filePath)
        console.log('Removed file:', filePath)
      } catch (e) {
        console.warn('Failed to remove file:', e.message)
      }
    } else {
      console.log('Kept file for inspection:', filePath)
    }
  }

  console.log('\nRunner complete')
}

run().catch((err) => {
  console.error('Error in runner:', err)
  process.exit(1)
})
