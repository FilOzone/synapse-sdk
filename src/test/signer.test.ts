/* globals describe it */
import { assert } from 'chai'
import { getUnderlyingSigner, isBrowserSigner, getEIP1193Provider } from '../utils/signer.js'

describe('Signer Utilities', () => {
  describe('getUnderlyingSigner', () => {
    it('should return the signer itself if not wrapped', () => {
      const mockSigner = {
        getAddress: async () => '0x1234567890123456789012345678901234567890'
      } as any

      const result = getUnderlyingSigner(mockSigner)
      assert.equal(result, mockSigner)
    })

    it('should unwrap NonceManager', () => {
      const baseSigner = {
        getAddress: async () => '0x1234567890123456789012345678901234567890'
      } as any

      const nonceManager = {
        signer: baseSigner,
        constructor: { name: 'NonceManager' }
      } as any

      const result = getUnderlyingSigner(nonceManager)
      assert.equal(result, baseSigner)
    })

    it('should not recursively unwrap nested NonceManagers', () => {
      const baseSigner = {
        getAddress: async () => '0x1234567890123456789012345678901234567890'
      } as any

      const innerNonceManager = {
        signer: baseSigner,
        constructor: { name: 'NonceManager' }
      } as any

      const outerNonceManager = {
        signer: innerNonceManager,
        constructor: { name: 'NonceManager' }
      } as any

      // Only unwraps one level
      const result = getUnderlyingSigner(outerNonceManager)
      assert.equal(result, innerNonceManager)
    })
  })

  describe('isBrowserSigner', () => {
    it('should return false for Wallet signer', async () => {
      const mockSigner = {
        constructor: { name: 'Wallet' },
        provider: {}
      } as any

      const result = await isBrowserSigner(mockSigner)
      assert.isFalse(result)
    })

    it('should return true for provider with _eip1193Provider', async () => {
      const mockProvider = {
        _eip1193Provider: {}
      }
      const mockSigner = {
        provider: mockProvider
      } as any

      const result = await isBrowserSigner(mockSigner)
      assert.isTrue(result)
    })

    it('should return true for provider with send method', async () => {
      const mockProvider = {
        send: async () => {}
      }
      const mockSigner = {
        provider: mockProvider
      } as any

      const result = await isBrowserSigner(mockSigner)
      assert.isTrue(result)
    })

    it('should return true for provider with request method', async () => {
      const mockProvider = {
        request: async () => {}
      }
      const mockSigner = {
        provider: mockProvider
      } as any

      const result = await isBrowserSigner(mockSigner)
      assert.isTrue(result)
    })

    it('should check underlying signer when wrapped in NonceManager', async () => {
      const mockProvider = {
        _eip1193Provider: {}
      }
      const baseSigner = {
        provider: mockProvider
      } as any

      const nonceManager = {
        signer: baseSigner,
        constructor: { name: 'NonceManager' }
      } as any

      const result = await isBrowserSigner(nonceManager)
      assert.isTrue(result)
    })

    it('should return false for signer without provider', async () => {
      const mockSigner = {} as any

      const result = await isBrowserSigner(mockSigner)
      assert.isFalse(result)
    })

    it('should handle errors gracefully', async () => {
      const mockSigner = {
        get provider () {
          throw new Error('Test error')
        }
      } as any

      const result = await isBrowserSigner(mockSigner)
      assert.isFalse(result)
    })
  })

  describe('getEIP1193Provider', () => {
    it('should return _eip1193Provider if present', () => {
      const eip1193 = { request: async () => {} }
      const mockProvider = {
        _eip1193Provider: eip1193
      }

      const result = getEIP1193Provider(mockProvider)
      assert.equal(result, eip1193)
    })

    it('should return provider if it has request method', () => {
      const mockProvider = {
        request: async () => {}
      }

      const result = getEIP1193Provider(mockProvider)
      assert.equal(result, mockProvider)
    })

    it('should return original provider as fallback', () => {
      const mockProvider = {
        someOtherMethod: () => {}
      }

      const result = getEIP1193Provider(mockProvider)
      assert.equal(result, mockProvider)
    })

    it('should handle providers that are functions', () => {
      const mockProvider = Object.assign(
        () => {}, // Function
        { request: async () => {} } // With request method
      )

      const result = getEIP1193Provider(mockProvider)
      assert.equal(result, mockProvider)
    })
  })
})
