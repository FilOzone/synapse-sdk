import assert from 'assert'
import type { Chain as ViemChain } from 'viem'
import { asChain, calibration, devnet, getChain, mainnet } from '../src/chains.ts'
import { UnsupportedChainError } from '../src/errors/chains.ts'

describe('chains', () => {
  describe('getChain', () => {
    it('should return mainnet by default', () => {
      assert.strictEqual(getChain(), mainnet)
    })

    it('should return mainnet for id 314', () => {
      assert.strictEqual(getChain(314), mainnet)
    })

    it('should return calibration for id 314159', () => {
      assert.strictEqual(getChain(314_159), calibration)
    })

    it('should return devnet for id 31415926', () => {
      assert.strictEqual(getChain(31_415_926), devnet)
    })

    it('should throw for unknown chain id', () => {
      assert.throws(() => getChain(999), /Chain with id 999 not found/)
    })
  })

  describe('asChain', () => {
    it('should pass through a valid Chain object unchanged', () => {
      assert.strictEqual(asChain(calibration), calibration)
      assert.strictEqual(asChain(mainnet), mainnet)
      assert.strictEqual(asChain(devnet), devnet)
    })

    it('should preserve custom chain config instead of clobbering it', () => {
      const customDevnet = {
        ...devnet,
        rpcUrls: {
          default: {
            http: ['http://custom-rpc:1234/rpc/v1'],
          },
        },
        contracts: {
          ...devnet.contracts,
          fwss: {
            ...devnet.contracts.fwss,
            address: '0x1111111111111111111111111111111111111111' as const,
          },
        },
      }

      const result = asChain(customDevnet)

      // asChain preserves the custom config
      assert.strictEqual(result.rpcUrls.default.http[0], 'http://custom-rpc:1234/rpc/v1')
      assert.strictEqual(result.contracts.fwss.address, '0x1111111111111111111111111111111111111111')

      // getChain would clobber the custom config, returning the canonical devnet
      const clobbered = getChain(customDevnet.id)
      assert.strictEqual(clobbered.rpcUrls.default.http[0], devnet.rpcUrls.default.http[0])
      assert.strictEqual(clobbered.contracts.fwss.address, devnet.contracts.fwss.address)
    })

    it('should throw UnsupportedChainError for unknown chain', () => {
      const unknownChain = { id: 999 } as ViemChain
      assert.throws(
        () => asChain(unknownChain),
        (err: unknown) => UnsupportedChainError.is(err)
      )
    })

    it('should throw for a chain with matching id but missing FOC contracts', () => {
      const bareChain = {
        id: 314,
        name: 'Filecoin',
        nativeCurrency: { name: 'FIL', symbol: 'FIL', decimals: 18 },
        rpcUrls: { default: { http: ['http://localhost'] } },
      } as ViemChain

      assert.throws(
        () => asChain(bareChain),
        (err: unknown) => UnsupportedChainError.is(err)
      )
    })
  })
})
