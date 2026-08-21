import assert from 'assert'
import type { Chain as ViemChain } from 'viem'
import { calibration, devnet, mainnet } from '../src/chains.ts'
import { calibrationTransport, devnetTransport, getTransport, mainnetTransport } from '../src/client.ts'
import { UnsupportedChainError } from '../src/errors/chains.ts'

describe('client', () => {
  describe('getTransport', () => {
    it('should return the mainnet fallback transport', () => {
      assert.strictEqual(getTransport(mainnet), mainnetTransport)
    })

    it('should return the calibration fallback transport', () => {
      assert.strictEqual(getTransport(calibration), calibrationTransport)
    })

    it('should return the devnet HTTP transport', () => {
      assert.strictEqual(getTransport(devnet), devnetTransport)
    })

    it('should throw UnsupportedChainError for an unknown chain', () => {
      const unknownChain = { id: 1 } as ViemChain
      assert.throws(
        () => getTransport(unknownChain),
        (err: unknown) => UnsupportedChainError.is(err)
      )
    })
  })
})
