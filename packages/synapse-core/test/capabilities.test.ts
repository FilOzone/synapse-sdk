import assert from 'assert'
import { decodeAddressCapability } from '../src/utils/capabilities.ts'

describe('Capabilities', () => {
  it('should decode address unmodified', () => {
    assert.equal(
      decodeAddressCapability('0x000000000004444c5dc75cb358380d2e3de08a90'),
      '0x000000000004444c5dc75cb358380d2e3de08a90'
    )
    assert.equal(
      decodeAddressCapability('0x4a6f6B9fF1fc974096f9063a45Fd12bD5B928AD1'),
      '0x4a6f6B9fF1fc974096f9063a45Fd12bD5B928AD1'
    )
  })

  it('should decode >64 bytes to the zero address', () => {
    assert.equal(
      decodeAddressCapability('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
      '0x0000000000000000000000000000000000000000'
    )
  })

  it('should decode address from the low bytes', () => {
    assert.equal(
      decodeAddressCapability('0x1234ffffffffffffffff6789ffffffffffffffffffffffffffffffffffffff0f'),
      '0xffffffffffffffffffffffffffffffffffffff0f'
    )
    assert.equal(
      decodeAddressCapability('0x1234eeeeeeeeeeeeee6789eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0e'),
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0e'
    )
    assert.equal(
      decodeAddressCapability('0x12dddddddddddddddddddddddddddddddddddddd0d'),
      '0xdddddddddddddddddddddddddddddddddddddd0d'
    )
  })

  it('should pad left to 20 bytes', () => {
    assert.equal(
      decodeAddressCapability('0x04444c5dc75cb358380d2e3de08a90'),
      '0x000000000004444c5dc75cb358380d2e3de08a90'
    )
    assert.equal(decodeAddressCapability('0x'), '0x0000000000000000000000000000000000000000')
  })
})
