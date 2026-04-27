import assert from 'assert'
import type { Hex } from 'viem'
import { bytesToHex, hexToString, parseEther, toBytes, toHex } from 'viem'
import { ValidationError } from '../src/errors/base.ts'
import type { PDPOffering } from '../src/sp-registry/types.ts'
import { PDP_OFFERING_KEYS, PDP_OFFERING_KEYS_SET } from '../src/utils/constants.ts'
import { decodePDPCapabilities, encodePDPCapabilities } from '../src/utils/pdp-capabilities.ts'

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

  describe('extraCapabilities', () => {
    it('preserves non-standard capabilities in extraCapabilities', () => {
      const capabilities = createMinimalCapabilities({
        serviceStatus: toHex('dev'),
        customFlag: '0x01',
      })

      const result = decodePDPCapabilities(capabilities)

      assert.ok(result.extraCapabilities)
      assert.strictEqual(result.extraCapabilities.serviceStatus, toHex('dev'))
      assert.strictEqual(result.extraCapabilities.customFlag, '0x01')
    })

    it('returns empty extraCapabilities when no non-standard capabilities exist', () => {
      const capabilities = createMinimalCapabilities()

      const result = decodePDPCapabilities(capabilities)

      assert.ok(result.extraCapabilities)
      assert.strictEqual(Object.keys(result.extraCapabilities).length, 0)
    })

    it('does not include standard capabilities in extraCapabilities', () => {
      const capabilities = createMinimalCapabilities({
        serviceStatus: toHex('dev'),
      })

      const result = decodePDPCapabilities(capabilities)

      assert.ok(result.extraCapabilities)
      assert.strictEqual(Object.keys(result.extraCapabilities).length, 1)
      assert.strictEqual(result.extraCapabilities.serviceURL, undefined)
      assert.strictEqual(result.extraCapabilities.location, undefined)
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

const baseOffering: PDPOffering = {
  serviceURL: 'https://provider.example.com',
  minPieceSizeInBytes: 1024n,
  maxPieceSizeInBytes: 1073741824n,
  storagePricePerTibPerDay: parseEther('0.1'),
  minProvingPeriodInEpochs: 2880n,
  location: 'us-east',
  paymentTokenAddress: '0x0000000000000000000000000000000000000000',
  ipniPiece: false,
  ipniIpfs: false,
}

describe('encodePDPCapabilities', () => {
  it('writes the 7 required keys in order', () => {
    const [keys] = encodePDPCapabilities(baseOffering)
    assert.deepStrictEqual(keys, [
      'serviceURL',
      'minPieceSizeInBytes',
      'maxPieceSizeInBytes',
      'storagePricePerTibPerDay',
      'minProvingPeriodInEpochs',
      'location',
      'paymentTokenAddress',
    ])
  })

  it('emits the ipniPiece / ipniIpfs flag keys only when truthy', () => {
    const [keysOff] = encodePDPCapabilities({ ...baseOffering, ipniPiece: false, ipniIpfs: false })
    assert.ok(!keysOff.includes(PDP_OFFERING_KEYS.IPNI_PIECE))
    assert.ok(!keysOff.includes(PDP_OFFERING_KEYS.IPNI_IPFS))

    const [keysOn, valuesOn] = encodePDPCapabilities({ ...baseOffering, ipniPiece: true, ipniIpfs: true })
    const pieceIdx = keysOn.indexOf(PDP_OFFERING_KEYS.IPNI_PIECE)
    const ipfsIdx = keysOn.indexOf(PDP_OFFERING_KEYS.IPNI_IPFS)
    assert.strictEqual(valuesOn[pieceIdx], '0x01')
    assert.strictEqual(valuesOn[ipfsIdx], '0x01')
  })

  it('encodes string extras as UTF-8 bytes', () => {
    const [keys, values] = encodePDPCapabilities(baseOffering, { tier: 'premium' })
    const idx = keys.indexOf('tier')
    assert.ok(idx >= 0)
    assert.strictEqual(hexToString(values[idx]), 'premium')
  })

  it('passes through values that are already hex verbatim', () => {
    const [keys, values] = encodePDPCapabilities(baseOffering, { customFlag: '0x01' })
    const idx = keys.indexOf('customFlag')
    assert.strictEqual(values[idx], '0x01')
  })

  it('rejects reserved PDP capability keys with a ValidationError', () => {
    for (const reserved of PDP_OFFERING_KEYS_SET) {
      assert.throws(
        () => encodePDPCapabilities(baseOffering, { [reserved]: 'whatever' }),
        (error: unknown) => {
          assert.ok(ValidationError.is(error), `expected ValidationError for "${reserved}"`)
          assert.match(error.message, /reserved for the PDP offering/)
          return true
        }
      )
    }
  })

  it('rejects empty-string capability values (no silent 0x01 fallback)', () => {
    assert.throws(
      () => encodePDPCapabilities(baseOffering, { customFlag: '' }),
      (error: unknown) => {
        assert.ok(ValidationError.is(error))
        assert.match(error.message, /empty value/)
        return true
      }
    )
  })

  it('accepts explicit 0x01 for flag-style extras', () => {
    const [keys, values] = encodePDPCapabilities(baseOffering, { trustMe: '0x01' })
    const idx = keys.indexOf('trustMe')
    assert.strictEqual(values[idx], '0x01')
  })

  it('round-trips location through hexToString', () => {
    const [keys, values] = encodePDPCapabilities({ ...baseOffering, location: 'eu-west' })
    const idx = keys.indexOf(PDP_OFFERING_KEYS.LOCATION)
    assert.strictEqual(hexToString(values[idx]), 'eu-west')
  })

  it('matches bytesToHex(toBytes(value)) for non-hex string extras', () => {
    const [keys, values] = encodePDPCapabilities(baseOffering, { note: 'hello' })
    const idx = keys.indexOf('note')
    assert.strictEqual(values[idx], bytesToHex(toBytes('hello')))
  })
})
