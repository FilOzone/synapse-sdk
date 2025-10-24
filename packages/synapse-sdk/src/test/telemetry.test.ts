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
  let provider: ethers.Provider
  let synapse: Synapse
  before(async () => {
    await server.start({ quiet: true })
    server.use(JSONRPC(presets.basic))
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    synapse = await Synapse.create({ provider })
  })

  after(async () => {
    server.stop()
    await synapse.telemetry.close()
    await synapse.getProvider().destroy()
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
      assert.isFalse(synapse.telemetry.isEnabled())
    })
  })

  describe('Debug Dump', () => {
    it('should return empty debug dump when telemetry is disabled', async () => {
      const debugDump = synapse.telemetry.debugDump()
      assert.equal(debugDump.events.length, 0)
    })
  })

  describe('Explicit Enable', () => {
    it('should allow enabling telemetry explicitly even when disabled by environment', async () => {
      // Verify telemetry is initially disabled
      assert.isFalse(synapse.telemetry.isEnabled())

      // Enable telemetry explicitly
      synapse.telemetry.enable()

      // Verify telemetry is now enabled
      assert.isTrue(synapse.telemetry.isEnabled())
    })
  })
})
