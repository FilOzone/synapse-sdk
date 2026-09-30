/**
 * Finds the COSE envelope boundary in an arbitrarily chunked encoded object.
 *
 * The scanner incrementally walks the structure of the first CBOR item
 * without decoding its values, so it can determine where the envelope ends
 * and detached ciphertext begins. It advances only over newly available
 * bytes and never reparses data it has already consumed.
 *
 * Once the boundary is found, `decodeEnvelope` runs exactly once on the
 * complete envelope and performs the package's normal validation. Truncated
 * input and malformed CBOR are reported separately.
 *
 * `scanEnvelopeStep` implements the stateless scanning step;
 * `createEnvelopeScanner` provides the stateful streaming wrapper.
 */
import { MalformedEnvelopeError } from '../errors.ts'
import { MAX_APP_METADATA_DEPTH, MAX_ENVELOPE_SIZE } from './constants.ts'
import { type DecodedEnvelope, decodeEnvelope } from './decode.ts'

/**
 * `cursor` is the start of the next head to read; it only ever moves
 * forward, and only once a head (and, for a string, its content) is fully
 * confirmed available. `stack` holds the remaining item count for each open
 * array/map/tag; the top level starts by expecting exactly one item.
 */
export interface EnvelopeScanState {
  cursor: number
  stack: number[]
}

/** A fresh scan state, ready to be passed to {@link scanEnvelopeStep} from the start of an envelope. */
export function createEnvelopeScanState(): EnvelopeScanState {
  return { cursor: 0, stack: [1] }
}

function closeFinished(stack: number[]): void {
  for (;;) {
    const top = stack[stack.length - 1]
    if (top === undefined || top > 0) return
    stack.pop()
  }
}

function decrementParent(stack: number[]): void {
  const top = stack[stack.length - 1]
  if (top !== undefined) {
    stack[stack.length - 1] = top - 1
  }
}

/**
 * Advances the incremental CBOR scan as far as the available bytes allow.
 *
 * Returns the byte length of the first complete top-level item, or `undefined`
 * if more input is needed. When input is incomplete, `state.cursor` remains at
 * the start of the unfinished item so only that item is reconsidered when more
 * bytes arrive.
 *
 * Rejects CBOR structures, nesting, and sizes that this envelope profile does
 * not permit. Full envelope validation is performed later by `decodeEnvelope`.
 */
export function scanEnvelopeStep(data: ArrayLike<number>, state: EnvelopeScanState): number | undefined {
  for (;;) {
    if (state.stack.length === 0) {
      return state.cursor
    }

    const headStart = state.cursor
    if (headStart >= data.length) {
      return undefined
    }

    const firstByte = data[headStart] as number
    const major = firstByte >>> 5
    const info = firstByte & 0x1f

    let extraBytes: number
    if (info < 24) {
      extraBytes = 0
    } else if (info === 24) {
      extraBytes = 1
    } else if (info === 25) {
      extraBytes = 2
    } else if (info === 26) {
      extraBytes = 4
    } else if (info === 27) {
      extraBytes = 8
    } else if (info === 31) {
      throw new MalformedEnvelopeError(
        'Malformed envelope: indefinite-length CBOR items and the break code are not permitted.'
      )
    } else {
      throw new MalformedEnvelopeError(
        `Malformed envelope: reserved CBOR additional information ${info} is not permitted.`
      )
    }

    const payloadStart = headStart + 1
    if (payloadStart + extraBytes > data.length) {
      return undefined // head itself is split across the available bytes; retry from headStart
    }

    let value: number
    if (extraBytes === 0) {
      value = info
    } else if (extraBytes <= 4) {
      value = 0
      for (let i = 0; i < extraBytes; i++) {
        value = value * 256 + (data[payloadStart + i] as number)
      }
    } else {
      // A nonzero high half is too large for a string length or container
      // count. Integer and tag values are not envelope lengths; the decoder
      // validates those after the scan.
      let high = 0
      for (let i = 0; i < 4; i++) {
        high = high * 256 + (data[payloadStart + i] as number)
      }
      if (high !== 0 && major >= 2 && major <= 5) {
        throw new MalformedEnvelopeError("Malformed envelope: an 8-byte CBOR length exceeds this profile's limits.")
      }
      value = 0
      for (let i = 4; i < 8; i++) {
        value = value * 256 + (data[payloadStart + i] as number)
      }
    }

    const nextPos = payloadStart + extraBytes
    const remainingBudget = MAX_ENVELOPE_SIZE - nextPos

    if (major === 2 || major === 3) {
      // Byte or text string: skip `value` content bytes without reading
      // them -- their content has no bearing on structure.
      if (value > remainingBudget) {
        throw new MalformedEnvelopeError(
          `Malformed envelope: a ${major === 2 ? 'byte' : 'text'} string of ${value} bytes exceeds the ${MAX_ENVELOPE_SIZE}-byte envelope budget.`
        )
      }
      const stringEnd = nextPos + value
      if (stringEnd > data.length) {
        return undefined // content not fully available yet; retry from headStart
      }
      decrementParent(state.stack)
      state.cursor = stringEnd
      closeFinished(state.stack)
      continue
    }

    if (major === 4 || major === 5 || major === 6) {
      // Array, map (pairs count double), or tag (always exactly one nested item).
      const items = major === 6 ? 1 : major === 5 ? value * 2 : value
      if (items > remainingBudget) {
        throw new MalformedEnvelopeError(
          `Malformed envelope: a container declaring ${items} items exceeds the ${MAX_ENVELOPE_SIZE}-byte envelope budget.`
        )
      }
      decrementParent(state.stack)
      // `state.stack` carries one extra, synthetic frame for the top level
      // (see createEnvelopeScanState) that `headers.ts`'s tokenizer doesn't
      // have -- its `open` array starts empty, not `[1]`. `state.stack.length`
      // here is already that tokenizer's `open.length + 1` for the same
      // wire position, so comparing it to the limit directly (no further
      // `+ 1`) is what keeps the two counts in step.
      if (state.stack.length > MAX_APP_METADATA_DEPTH) {
        throw new MalformedEnvelopeError(
          `Malformed envelope: CBOR nesting deeper than ${MAX_APP_METADATA_DEPTH} levels is not permitted.`
        )
      }
      state.cursor = nextPos
      state.stack.push(items)
      closeFinished(state.stack)
      continue
    }

    // Major 0 (uint), 1 (negint), 7 (simple/float): nothing further to skip.
    decrementParent(state.stack)
    state.cursor = nextPos
    closeFinished(state.stack)
  }
}

export interface EnvelopeScanResult {
  decoded: DecodedEnvelope
  /** Bytes after the envelope: a view into whichever `push()` block supplied them, not a copy. */
  rest: Uint8Array
}

export interface EnvelopeScanner {
  /**
   * Feed the next block. Returns the decoded envelope plus any trailing
   * ciphertext from this same block once the envelope completes, or
   * `undefined` while more input is still needed. Calling this again after
   * it has already returned a result is a caller bug.
   */
  push(block: Uint8Array): EnvelopeScanResult | undefined
  /** The source ended. Throws if the envelope never completed. */
  finish(): void
}

/**
 * Decode one envelope across any number of input blocks, up to
 * `MAX_ENVELOPE_SIZE` bytes. Until the envelope is complete, `push()` returns
 * `undefined`. On completion it returns decoded fields independent of the
 * caller's blocks, plus a `rest` view into the block that ended the envelope.
 */
export function createEnvelopeScanner(): EnvelopeScanner {
  let buffer = new Uint8Array(1024)
  let filled = 0
  const state = createEnvelopeScanState()
  let completed = false

  function ensureCapacity(needed: number): void {
    if (buffer.length >= needed) return
    let capacity = buffer.length
    while (capacity < needed) capacity *= 2
    const grown = new Uint8Array(Math.min(capacity, MAX_ENVELOPE_SIZE))
    grown.set(buffer.subarray(0, filled))
    buffer = grown
  }

  function push(block: Uint8Array): EnvelopeScanResult | undefined {
    if (completed) {
      throw new Error('createEnvelopeScanner: push() called after the envelope already completed.')
    }

    const filledBefore = filled
    // Never let the scan see more than the envelope's own size ceiling.
    const extraLength = Math.min(block.length, MAX_ENVELOPE_SIZE - filledBefore)
    ensureCapacity(filledBefore + extraLength)
    buffer.set(block.subarray(0, extraLength), filledBefore)

    const length = scanEnvelopeStep(buffer.subarray(0, filledBefore + extraLength), state)
    if (length === undefined) {
      // Not complete yet: everything offered so far might still be envelope.
      filled = filledBefore + extraLength
      if (filled >= MAX_ENVELOPE_SIZE) {
        throw new MalformedEnvelopeError(`Malformed envelope: exceeds the ${MAX_ENVELOPE_SIZE}-byte envelope limit.`)
      }
      return undefined
    }

    // Complete: anything past `length` in the buffer is unused scratch.
    const consumedFromBlock = length - filledBefore
    filled = length
    completed = true

    const decoded = decodeEnvelope(buffer.subarray(0, length))
    if (decoded.envelopeLength !== length) {
      throw new MalformedEnvelopeError(
        'Malformed envelope: internal inconsistency between the structural scan and decodeEnvelope.'
      )
    }

    return { decoded, rest: block.subarray(consumedFromBlock) }
  }

  function finish(): void {
    if (completed) return
    throw new MalformedEnvelopeError('Malformed envelope: input ended inside the envelope.')
  }

  return { push, finish }
}
