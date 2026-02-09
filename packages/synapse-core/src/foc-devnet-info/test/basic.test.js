/**
 * ⚠️  IMPORTANT DISCLAIMER ⚠️
 *
 * This test assumes the following prerequisites are met:
 *
 * 1. The foc-devnet is already up and running with a Lotus RPC endpoint
 *    accessible at the configured host_rpc_url
 *
 * 2. The devnet-info.json file exists at the default location:
 *    ~/.foc-devnet/state/latest/devnet-info.json
 *
 * If either of these conditions is not met, this test will fail.
 *
 * To start the foc-devnet, refer to the project documentation.
 */

import { existsSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { createPublicClient, http } from 'viem'
import { getDefaultPath, loadDevnetInfo, toViemChain } from '../dist/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main() {
  console.log('Loading test devnet info...')

  // Assertion: Check that devnet info file exists
  const testDataPath = getDefaultPath()
  if (!existsSync(testDataPath)) {
    console.error(`✗ ASSERTION FAILED: devnet-info.json not found at ${testDataPath}`)
    console.error('   Make sure the foc-devnet is running and has generated devnet-info.json')
    process.exit(1)
  }
  console.log(`✓ Found devnet-info.json at ${testDataPath}`)

  // Load the test devnet info
  const devnetInfo = loadDevnetInfo(testDataPath)

  console.log(`✓ Loaded devnet info for run: ${devnetInfo.info.run_id}`)

  // Get USER_1 details
  const user1 = devnetInfo.info.users[0]
  console.log(`✓ USER_1 native address: ${user1.native_addr}`)
  console.log(`✓ USER_1 EVM address: ${user1.evm_addr}`)

  // Create viem chain and client
  const chain = toViemChain(devnetInfo)
  console.log(`✓ Created viem chain: ${chain.name}`)

  const client = createPublicClient({
    chain,
    transport: http(),
  })

  console.log('✓ Created viem client')

  // Assertion: Check that devnet RPC is accessible
  try {
    await client.getBlockNumber()
    console.log(`✓ Verified foc-devnet RPC is accessible at ${chain.rpcUrls.default.http[0]}`)
  } catch (error) {
    console.error(`✗ ASSERTION FAILED: Cannot connect to foc-devnet RPC at ${chain.rpcUrls.default.http[0]}`)
    console.error(`   Make sure the foc-devnet Lotus node is running: ${error.message}`)
    process.exit(1)
  }

  // Query USER_1's native FIL balance using EVM address
  try {
    const balance = await client.getBalance({
      address: user1.evm_addr,
    })

    console.log(`✓ Retrieved balance for ${user1.name}`)
    console.log(`  Native address: ${user1.native_addr}`)
    console.log(`  EVM address: ${user1.evm_addr}`)
    console.log(`  Balance: ${balance} wei`)
    console.log(`  Balance (FIL): ${balance / BigInt(1e18)}`)
  } catch (error) {
    console.error('✗ Failed to query balance:', error.message)
    process.exit(1)
  }

  console.log('\n✓ Test passed!')
}

main().catch((error) => {
  console.error('✗ Test failed:', error)
  process.exit(1)
})
