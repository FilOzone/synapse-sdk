import assert from 'assert'
import type { Hex } from 'viem'
import { toHex } from 'viem'
import { decodePDPCapabilities } from '../src/utils/pdp-capabilities.ts'

describe('decodePDPCapabilities', () => {
  describe('IPNIPeerID decoding', () => {
    it('decodes hex-encoded peer ID to base58btc', () => {
      const peerIdHex = '0x00240801122044419f375a0ea0f06cdb991441b26590344c2e1d607846e8b321981b3f67a667'

      const capabilities = createMinimalCapabilities({
        IPNIPeerID: peerIdHex,
      })

      const result = decodePDPCapabilities(capabilities)

      assert.strictEqual(result.ipniPeerId, 'z12D3KooWEQovpB7KFS5vE7agxzzxAmXZbWRysFqLp396ojUxgWeA')
    })

    it('returns undefined when IPNIPeerID capability is missing', () => {
      const capabilities = createMinimalCapabilities()
      // Explicitly ensure IPNIPeerID is not present
      delete (capabilities as Record<string, Hex | undefined>).IPNIPeerID

      const result = decodePDPCapabilities(capabilities)

      assert.strictEqual(result.ipniPeerId, undefined)
    })
  })
})

// Minimal valid capabilities for testing (all required fields)
function createMinimalCapabilities(overrides: Record<string, Hex> = {}): Record<string, Hex> {
  return {
    serviceURL: toHex('https://example.com'),
    minPieceSizeInBytes: '0x01',
    maxPieceSizeInBytes: '0xff',
    storagePricePerTibPerDay: '0x01',
    minProvingPeriodInEpochs: '0x01',
    location: toHex('US'),
    paymentTokenAddress: '0x0000000000000000000000000000000000000001',
    ...overrides,
  }
}
