/* globals describe it beforeEach afterEach */

/**
 * Tests for telemetry functionality
 *
 * These tests verify that telemetry is properly disabled during testing
 * and that the telemetry system works correctly when enabled.
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { Synapse } from '../synapse.ts'
import { getGlobalTelemetry } from '../telemetry/singleton.ts'
import { JSONRPC, presets } from './mocks/jsonrpc/index.ts'

// Mock server for testing
const server = setup([])

describe('Telemetry', () => {
  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('Test Environment Detection', () => {
    it('should disable telemetry in test environment', () => {
      // Verify that global telemetry instance is null when not initialized
      const globalTelemetry = getGlobalTelemetry()
      assert.isNull(globalTelemetry)
    })

    it('should not initialize telemetry when creating Synapse in test environment', async () => {
      // Set up proper mock responses for contract calls
      server.use(JSONRPC(presets.basic))

      // Create a real provider that will use the mocked responses
      const provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')

      // Create Synapse instance - telemetry should be disabled
      const synapse = await Synapse.create({ provider })

      // Verify that telemetry is disabled
      assert.isFalse(synapse.telemetry.isEnabled())

      // Verify that debug dump shows disabled state
      const debugDump = synapse.telemetry.debugDump()
      assert.isFalse(debugDump.context.enabled)
      assert.equal(debugDump.context.runtime, 'node')
      assert.equal(debugDump.context.network, 'calibration')
    })
  })

  describe('Debug Dump', () => {
    it('should return empty debug dump when telemetry is disabled', async () => {
      // Set up proper mock responses for contract calls
      server.use(JSONRPC(presets.basic))

      // Create a real provider that will use the mocked responses
      const provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')

      const synapse = await Synapse.create({ provider })

      // Get debug dump
      const debugDump = synapse.telemetry.debugDump()

      // Verify structure
      assert.isObject(debugDump)
      assert.isArray(debugDump.events)
      assert.isObject(debugDump.context)
      assert.isString(debugDump.timestamp)

      // Verify disabled state
      assert.isFalse(debugDump.context.enabled)
      assert.equal(debugDump.events.length, 0)
    })
  })

  describe('Explicit Enable', () => {
    it('should allow enabling telemetry explicitly even when disabled by environment', async () => {
      // Set up proper mock responses for contract calls
      server.use(JSONRPC(presets.basic))

      // Create a real provider that will use the mocked responses
      const provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')

      // Create Synapse instance - telemetry should be disabled by default in test environment
      const synapse = await Synapse.create({ provider })

      // Verify telemetry is initially disabled
      assert.isFalse(synapse.telemetry.isEnabled())

      // Enable telemetry explicitly
      synapse.telemetry.enable()

      // Verify telemetry is now enabled
      assert.isTrue(synapse.telemetry.isEnabled())

      // Verify debug dump shows enabled state
      const debugDump = synapse.telemetry.debugDump()
      assert.isTrue(debugDump.context.enabled)
    })
  })
})
