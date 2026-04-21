import assert from 'assert'
import { parseEther } from 'viem'
import { calibration } from '../src/chains.ts'
import { ValidationError } from '../src/errors/base.ts'
import { addProductCall } from '../src/sp-registry/add-product.ts'
import { registerProviderCall } from '../src/sp-registry/register-provider.ts'
import type { PDPOffering } from '../src/sp-registry/types.ts'
import { updateProductCall } from '../src/sp-registry/update-product.ts'
import { updateProviderInfoCall } from '../src/sp-registry/update-provider-info.ts'
import {
  validateCapabilities,
  validateLocation,
  validatePayee,
  validateProductType,
  validateProviderInfo,
  validateRegistrationFee,
} from '../src/sp-registry/validation.ts'
import { SERVICE_PROVIDER_REGISTRY as sp } from '../src/utils/constants.ts'

const validPdpOffering: PDPOffering = {
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

describe('sp-registry validation', () => {
  describe('validateProviderInfo', () => {
    it('accepts name at exactly sp.MAX_NAME_LENGTH bytes and description at exactly sp.MAX_DESCRIPTION_LENGTH bytes', () => {
      validateProviderInfo({
        name: 'a'.repeat(sp.MAX_NAME_LENGTH),
        description: 'b'.repeat(sp.MAX_DESCRIPTION_LENGTH),
      })
    })

    it('rejects name longer than sp.MAX_NAME_LENGTH bytes', () => {
      assert.throws(
        () =>
          validateProviderInfo({
            name: 'a'.repeat(sp.MAX_NAME_LENGTH + 1),
            description: 'ok',
          }),
        (error: unknown) => {
          assert.ok(ValidationError.is(error), 'expected ValidationError')
          assert.match(error.message, /Provider name is too long/)
          return true
        }
      )
    })

    it('rejects description longer than sp.MAX_DESCRIPTION_LENGTH bytes', () => {
      assert.throws(
        () =>
          validateProviderInfo({
            name: 'ok',
            description: 'b'.repeat(sp.MAX_DESCRIPTION_LENGTH + 1),
          }),
        (error: unknown) => {
          assert.ok(ValidationError.is(error))
          assert.match(error.message, /Provider description is too long/)
          return true
        }
      )
    })

    it('counts UTF-8 bytes, not code points', () => {
      // "🦀" is 4 UTF-8 bytes; 33 of them = 132 bytes > sp.MAX_NAME_LENGTH (128)
      assert.throws(
        () =>
          validateProviderInfo({
            name: '🦀'.repeat(33),
            description: 'ok',
          }),
        ValidationError
      )
      // 32 crabs = 128 bytes, exactly at the limit
      validateProviderInfo({ name: '🦀'.repeat(32), description: 'ok' })
    })
  })

  describe('validatePayee', () => {
    it('accepts non-zero addresses', () => {
      validatePayee('0x1234567890123456789012345678901234567890')
    })

    it('rejects the zero address', () => {
      assert.throws(
        () => validatePayee('0x0000000000000000000000000000000000000000'),
        (error: unknown) => {
          assert.ok(ValidationError.is(error))
          assert.match(error.message, /zero address/)
          return true
        }
      )
    })
  })

  describe('validateProductType', () => {
    it('accepts 0 (PDP)', () => {
      validateProductType(0)
    })

    it('rejects non-zero values', () => {
      assert.throws(() => validateProductType(1), ValidationError)
      assert.throws(() => validateProductType(42), ValidationError)
    })
  })

  describe('validateLocation', () => {
    it('accepts empty and up-to-limit locations', () => {
      validateLocation('')
      validateLocation('a'.repeat(sp.MAX_LOCATION_LENGTH))
    })

    it('rejects locations longer than sp.MAX_LOCATION_LENGTH bytes', () => {
      assert.throws(() => validateLocation('a'.repeat(sp.MAX_LOCATION_LENGTH + 1)), ValidationError)
    })
  })

  describe('validateCapabilities', () => {
    it('accepts balanced, bounded arrays', () => {
      validateCapabilities(['key'], ['0x01'])
      validateCapabilities([], [])
    })

    it('rejects mismatched lengths', () => {
      assert.throws(
        () => validateCapabilities(['a', 'b'], ['0x01']),
        (error: unknown) => {
          assert.ok(ValidationError.is(error))
          assert.match(error.message, /same length/)
          return true
        }
      )
    })

    it('rejects more than sp.MAX_CAPABILITIES entries', () => {
      const keys = Array.from({ length: sp.MAX_CAPABILITIES + 1 }, (_, i) => `key${i}`)
      const values = keys.map(() => '0x01' as const)
      assert.throws(() => validateCapabilities(keys, values), /Too many capabilities/)
    })

    it('rejects empty keys', () => {
      assert.throws(() => validateCapabilities([''], ['0x01']), /Capability key at index 0 cannot be empty/)
    })

    it('rejects keys longer than sp.MAX_CAPABILITY_KEY_LENGTH bytes', () => {
      assert.throws(
        () => validateCapabilities(['a'.repeat(sp.MAX_CAPABILITY_KEY_LENGTH + 1)], ['0x01']),
        /Capability key at index 0 is too long/
      )
    })

    it('rejects empty values (0x)', () => {
      assert.throws(() => validateCapabilities(['key'], ['0x']), /Capability value at index 0 .* cannot be empty/)
    })

    it('rejects values longer than sp.MAX_CAPABILITY_VALUE_LENGTH bytes', () => {
      const tooLong = `0x${'ff'.repeat(sp.MAX_CAPABILITY_VALUE_LENGTH + 1)}` as const
      assert.throws(() => validateCapabilities(['key'], [tooLong]), /Capability value at index 0 .* is too long/)
    })
  })

  describe('validateRegistrationFee', () => {
    it('accepts the exact sp.REGISTRATION_FEE_WEI value', () => {
      validateRegistrationFee(sp.REGISTRATION_FEE_WEI)
    })

    it('rejects any other value', () => {
      assert.throws(() => validateRegistrationFee(0n), /Incorrect registration fee/)
      assert.throws(() => validateRegistrationFee(sp.REGISTRATION_FEE_WEI + 1n), /Incorrect registration fee/)
      assert.throws(() => validateRegistrationFee(parseEther('10')), /Incorrect registration fee/)
    })
  })

  describe('registerProviderCall wiring', () => {
    const baseOptions = {
      chain: calibration,
      payee: '0x1234567890123456789012345678901234567890' as const,
      name: 'Test Provider',
      description: 'Test Description',
      productType: 0,
      pdpOffering: validPdpOffering,
      value: parseEther('5'),
    }

    it('passes validation for well-formed options', () => {
      registerProviderCall(baseOptions)
    })

    it('rejects zero-address payee', () => {
      assert.throws(
        () =>
          registerProviderCall({
            ...baseOptions,
            payee: '0x0000000000000000000000000000000000000000',
          }),
        ValidationError
      )
    })

    it('rejects unsupported productType', () => {
      assert.throws(() => registerProviderCall({ ...baseOptions, productType: 1 }), ValidationError)
    })

    it('rejects over-long name', () => {
      assert.throws(
        () => registerProviderCall({ ...baseOptions, name: 'a'.repeat(sp.MAX_NAME_LENGTH + 1) }),
        ValidationError
      )
    })

    it('rejects over-long description', () => {
      assert.throws(
        () => registerProviderCall({ ...baseOptions, description: 'b'.repeat(sp.MAX_DESCRIPTION_LENGTH + 1) }),
        ValidationError
      )
    })

    it('rejects over-long location inside the PDP offering', () => {
      assert.throws(
        () =>
          registerProviderCall({
            ...baseOptions,
            pdpOffering: {
              ...validPdpOffering,
              location: 'a'.repeat(sp.MAX_LOCATION_LENGTH + 1),
            },
          }),
        ValidationError
      )
    })

    it('rejects over-long user-supplied capability value after encoding', () => {
      assert.throws(
        () =>
          registerProviderCall({
            ...baseOptions,
            capabilities: { custom: 'x'.repeat(sp.MAX_CAPABILITY_VALUE_LENGTH + 1) },
          }),
        ValidationError
      )
    })

    it('rejects too-long user-supplied capability key after encoding', () => {
      assert.throws(
        () =>
          registerProviderCall({
            ...baseOptions,
            capabilities: { ['k'.repeat(sp.MAX_CAPABILITY_KEY_LENGTH + 1)]: 'v' },
          }),
        ValidationError
      )
    })
  })

  describe('updateProviderInfoCall wiring', () => {
    it('accepts valid name and description', () => {
      updateProviderInfoCall({ chain: calibration, name: 'n', description: 'd' })
    })

    it('rejects over-long name', () => {
      assert.throws(
        () =>
          updateProviderInfoCall({ chain: calibration, name: 'a'.repeat(sp.MAX_NAME_LENGTH + 1), description: 'd' }),
        ValidationError
      )
    })

    it('rejects over-long description', () => {
      assert.throws(
        () =>
          updateProviderInfoCall({
            chain: calibration,
            name: 'n',
            description: 'b'.repeat(sp.MAX_DESCRIPTION_LENGTH + 1),
          }),
        ValidationError
      )
    })
  })

  describe('addProductCall wiring', () => {
    it('rejects unsupported productType', () => {
      assert.throws(
        () =>
          addProductCall({
            chain: calibration,
            productType: 1,
            capabilityKeys: ['serviceURL'],
            capabilityValues: ['0x01'],
          }),
        ValidationError
      )
    })

    it('rejects empty capability value', () => {
      assert.throws(
        () =>
          addProductCall({
            chain: calibration,
            productType: 0,
            capabilityKeys: ['serviceURL'],
            capabilityValues: ['0x'],
          }),
        ValidationError
      )
    })

    it('rejects mismatched key/value array lengths', () => {
      assert.throws(
        () =>
          addProductCall({
            chain: calibration,
            productType: 0,
            capabilityKeys: ['serviceURL', 'location'],
            capabilityValues: ['0x01'],
          }),
        ValidationError
      )
    })
  })

  describe('updateProductCall wiring', () => {
    it('rejects unsupported productType', () => {
      assert.throws(
        () =>
          updateProductCall({
            chain: calibration,
            productType: 2,
            capabilityKeys: ['serviceURL'],
            capabilityValues: ['0x01'],
          }),
        ValidationError
      )
    })

    it('rejects over-long capability key', () => {
      assert.throws(
        () =>
          updateProductCall({
            chain: calibration,
            productType: 0,
            capabilityKeys: ['k'.repeat(sp.MAX_CAPABILITY_KEY_LENGTH + 1)],
            capabilityValues: ['0x01'],
          }),
        ValidationError
      )
    })
  })
})
