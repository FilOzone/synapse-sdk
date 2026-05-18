/**
 * FR32 expansion: inserts 2 zero bits per 254 source bits to fit BLS12-381
 * field element boundaries. 127 source bytes expand to 128 output bytes.
 *
 * Distinct from zero-padding, which fills a payload up to a `127 × 2^n`
 * source-byte boundary so that the FR32-expanded result forms a full binary
 * tree. The pipeline is: raw → zero-pad to next `127 × 2^n` → FR32 expand →
 * 32-byte merkle leaves. ({@link MIN_PAYLOAD_SIZE} clamps tiny inputs; it
 * isn't the general padding target.)
 *
 * Reference: FRC-0069
 * https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 */

import { FR_RATIO, IN_BYTES_PER_QUAD, MIN_PAYLOAD_SIZE, OUT_BYTES_PER_QUAD } from './constants.ts'

/**
 * Bytes of zero-padding required to bring a payload up to the next pow2-aligned
 * piece while leaving room for FR32 expansion.
 */
export function toZeroPaddedSize(payloadSize: number): number {
  const size = Math.max(payloadSize, MIN_PAYLOAD_SIZE)
  const highestBit = Math.floor(Math.log2(size))
  const bound = Math.ceil(FR_RATIO * 2 ** (highestBit + 1))
  return size <= bound ? bound : Math.ceil(FR_RATIO * 2 ** (highestBit + 2))
}

/**
 * FR32-expanded byte size for a given raw payload size.
 */
export function toPieceSize(size: number): number {
  return toZeroPaddedSize(size) / FR_RATIO
}

/**
 * Raw byte size derivable from an FR32-expanded byte size.
 */
export function fromPieceSize(size: number): number {
  return size * FR_RATIO
}

/**
 * Apply FR32 expansion to `source`, returning expanded bytes (~1.0079× input).
 */
export function expand(source: Uint8Array): Uint8Array {
  const output = new Uint8Array(toPieceSize(source.length))
  const size = toZeroPaddedSize(source.byteLength)
  const quadCount = size / IN_BYTES_PER_QUAD

  // Each 127 source bytes expand to 128 output bytes by inserting 2 zero bits
  // at positions 254, 508, 762, 1016 (within the 1024-bit quad).
  for (let n = 0; n < quadCount; n++) {
    const readOffset = n * IN_BYTES_PER_QUAD
    const writeOffset = n * OUT_BYTES_PER_QUAD

    // First 31 bytes + 6 bits taken as-is.
    output.set(source.subarray(readOffset, readOffset + 32), writeOffset)
    output[writeOffset + 31] &= 0b00111111

    for (let i = 32; i < 64; i++) {
      output[writeOffset + i] = (source[readOffset + i] << 2) | (source[readOffset + i - 1] >> 6)
    }
    output[writeOffset + 63] &= 0b00111111

    for (let i = 64; i < 96; i++) {
      output[writeOffset + i] = (source[readOffset + i] << 4) | (source[readOffset + i - 1] >> 4)
    }
    output[writeOffset + 95] &= 0b00111111

    for (let i = 96; i < 127; i++) {
      output[writeOffset + i] = (source[readOffset + i] << 6) | (source[readOffset + i - 1] >> 2)
    }
    output[writeOffset + 127] = source[readOffset + 126] >> 2
  }

  return output
}

/**
 * Reverse FR32 expansion, returning raw bytes.
 */
export function reduce(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(fromPieceSize(source.length))
  const chunks = source.length / 128
  for (let chunk = 0; chunk < chunks; chunk++) {
    const inOffNext = chunk * 128 + 1
    const outOff = chunk * 127

    let at = source[chunk * 128]

    for (let i = 0; i < 32; i++) {
      const next = source[i + inOffNext]
      out[outOff + i] = at
      at = next
    }
    out[outOff + 31] |= at << 6

    for (let i = 32; i < 64; i++) {
      const next = source[i + inOffNext]
      out[outOff + i] = at >> 2
      out[outOff + i] |= next << 6
      at = next
    }
    out[outOff + 63] ^= (at << 6) ^ (at << 4)

    for (let i = 64; i < 96; i++) {
      const next = source[i + inOffNext]
      out[outOff + i] = at >> 4
      out[outOff + i] |= next << 4
      at = next
    }
    out[outOff + 95] ^= (at << 4) ^ (at << 2)

    for (let i = 96; i < 127; i++) {
      const next = source[i + inOffNext]
      out[outOff + i] = at >> 6
      out[outOff + i] |= next << 2
      at = next
    }
  }

  return out
}
