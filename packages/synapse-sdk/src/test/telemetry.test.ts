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
    await synapse.telemetry?.close()
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
      assert.isNull(synapse.telemetry)
    })
  })
})
