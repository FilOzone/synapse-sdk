/**
 * Turn a caller's byte range into an exact ciphertext span and chunk plan for
 * the chunked scheme. Pure arithmetic: no I/O, no crypto, no streams -- every
 * input is a plain number already in hand (from a decoded envelope, or from
 * library-created cached params). See docs/tech-spec.md, "Random-access
 * source contract" and its `RandomAccessSource`/`decryptRange` API block.
 *
 * Semantics (HTTP-like):
 * - The object's total plaintext length always comes from `sourceSize` and
 *   `headerLength` via `chunkLayout`, never from a cached/declared
 *   `plaintextLength` alone -- that value is only ever checked against the
 *   derived layout, the same direction every other reader in this package
 *   checks it.
 * - An empty object (`totalPlaintextLength === 0`) has no valid range;
 *   `decrypt()` already handles an empty object directly.
 * - `offset >= 0`: `offset` must be strictly less than the total. `end` is
 *   `offset + length`, clamped to the total; omitting `length` means "to the
 *   end".
 * - `offset < 0`: a suffix range, e.g. `-1024` means "the last 1024 bytes".
 *   It carries no `length`. An overlong suffix clamps to the whole object
 *   rather than failing.
 */
import { chunkLayout } from './chunk-layout.ts'
import { TAG_SIZE } from './constants.ts'
import { describeCborType } from './cose/headers.ts'
import { InvalidCiphertextLengthError, InvalidRangeError, InvalidSourceLengthError } from './errors.ts'

/** A byte range over an object's plaintext, HTTP `Range`-header style. */
export interface ByteRange {
  /** Non-negative: from the start. Negative: a suffix, e.g. `-1024` is the last 1024 bytes. */
  offset: number
  /** Bytes to include. Omitted means "to the end". Forbidden together with a negative `offset`. */
  length?: number
}

/** The chunked envelope values a plan is computed from -- trusted, already-validated numbers. */
export interface ChunkedRangeLayoutInput {
  /** Total size of the encoded object: envelope plus detached ciphertext. */
  sourceSize: number
  /** Byte length of the envelope, i.e. where the detached ciphertext begins. */
  headerLength: number
  chunkSize: number
  /** Checked against the layout `chunkLayout` derives from `sourceSize`/`headerLength`, not trusted outright. */
  plaintextLength?: number
}

export interface RangePlan {
  /** The whole object's plaintext length, derived from the source size, not from `plaintextLength` alone. */
  totalPlaintextLength: number
  /** Bytes this range actually covers: `end - start`. */
  rangeLength: number
  /** Absolute bytes to fetch from the source, envelope included. */
  ciphertextSpan: { offset: number; length: number }
  /** Index of the first chunk the range touches. */
  firstChunk: number
  /** Index of the last chunk the range touches (inclusive). */
  lastChunk: number
  /** Total chunks in the object. */
  chunkCount: number
  /** Plaintext bytes to drop from the start of the first decrypted chunk. */
  skip: number
  /** Whether `lastChunk` is the object's actual final chunk (`lastChunk === chunkCount - 1`). */
  includesFinalChunk: boolean
  /** Wire length (ciphertext plus tag) of `lastChunk`: `chunkSize + TAG_SIZE`, or the object's real final length when `includesFinalChunk`. */
  lastChunkCipherLength: number
}

function assertValidByteRange(range: unknown): asserts range is ByteRange {
  if (range === null || typeof range !== 'object') {
    throw new InvalidRangeError(`Invalid range: expected an object, got ${describeCborType(range)}.`)
  }
  const { offset, length } = range as { offset: unknown; length: unknown }
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset)) {
    throw new InvalidRangeError(
      `Invalid range offset: ${describeCborType(offset)} ${String(offset)}. Expected a safe integer.`
    )
  }
  if (length !== undefined && (typeof length !== 'number' || !Number.isSafeInteger(length) || length <= 0)) {
    throw new InvalidRangeError(
      `Invalid range length: ${describeCborType(length)} ${String(length)}. Expected a positive safe integer, or omitted.`
    )
  }
  if (offset < 0 && length !== undefined) {
    throw new InvalidRangeError(
      `Invalid range: a suffix offset (${offset}) takes no length; a suffix always runs to the end.`
    )
  }
}

/**
 * Plan the exact ciphertext span and chunk indices `range` needs, for a
 * chunked object already located by `layoutInput`. Reused identically by
 * `decryptRange` and `decryptRangeWith`.
 */
export function planRange(layoutInput: ChunkedRangeLayoutInput, range: unknown): RangePlan {
  const { sourceSize, headerLength, chunkSize, plaintextLength: declaredPlaintextLength } = layoutInput
  if (sourceSize < headerLength) {
    throw new InvalidSourceLengthError(
      `Invalid range source: size ${sourceSize} is smaller than the envelope's header length ${headerLength}.`
    )
  }

  const layout = chunkLayout(sourceSize - headerLength, chunkSize)
  if (declaredPlaintextLength !== undefined && layout.plaintextLength !== declaredPlaintextLength) {
    throw new InvalidCiphertextLengthError(
      `Invalid encoded object: the ciphertext implies a plaintext of ${layout.plaintextLength} bytes, ` +
        `but the declared plaintext_length is ${declaredPlaintextLength}.`
    )
  }
  const total = layout.plaintextLength

  assertValidByteRange(range)
  const { offset, length } = range

  if (total === 0) {
    throw new InvalidRangeError('Invalid range: the object is empty; decrypt() handles an empty object directly.')
  }

  let start: number
  let end: number
  if (offset < 0) {
    // Suffix: an overlong request just means "the whole object".
    start = Math.max(0, total + offset)
    end = total
  } else {
    if (offset >= total) {
      throw new InvalidRangeError(`Invalid range offset ${offset}: at or past the total plaintext length ${total}.`)
    }
    // Avoids ever forming offset + length when length could be astronomically
    // large (up to Number.MAX_SAFE_INTEGER) -- compare against the remainder instead.
    end = length === undefined || length >= total - offset ? total : offset + length
    start = offset
  }

  const stride = chunkSize + TAG_SIZE
  const firstChunk = Math.floor(start / chunkSize)
  const lastChunk = Math.floor((end - 1) / chunkSize)
  const skip = start - firstChunk * chunkSize
  const includesFinalChunk = lastChunk === layout.chunkCount - 1

  const spanOffset = headerLength + firstChunk * stride
  const spanEnd = includesFinalChunk ? sourceSize : headerLength + (lastChunk + 1) * stride

  return {
    totalPlaintextLength: total,
    rangeLength: end - start,
    ciphertextSpan: { offset: spanOffset, length: spanEnd - spanOffset },
    firstChunk,
    lastChunk,
    chunkCount: layout.chunkCount,
    skip,
    includesFinalChunk,
    lastChunkCipherLength: includesFinalChunk ? layout.lastChunkCipherLength : stride,
  }
}
