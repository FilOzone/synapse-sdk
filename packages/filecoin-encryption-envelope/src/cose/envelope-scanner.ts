/**
 * Finds where a streamed envelope ends, without decoding it.
 *
 * A streaming reader receives the object in arbitrary blocks and has to know
 * where the envelope (one CBOR item) ends and detached ciphertext begins,
 * before it can hand the envelope to `decodeEnvelope`. Retrying
 * `decodeEnvelope` on a growing prefix can't tell "truncated" from
 * "malformed" and is quadratic (each retry re-parses everything seen so
 * far). Instead: a resumable scan over CBOR *structure* only -- heads, string
 * lengths, container counts -- that commits forward one head at a time and
 * never re-examines bytes it has already skipped past. Once it finds the
 * end, `decodeEnvelope` runs exactly once, on exactly the right bytes, for
 * every profile validation this package already does.
 *
 * `scanEnvelopeStep` is the pure step, exported so a test can drive it
 * directly (and count byte reads). `createEnvelopeScanner` is the stateful
 * wrapper a reader actually uses.
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

/** Pop any container whose remaining item count has reached zero, cascading outward. Mirrors `headers.ts`'s tokenizer. */
function closeFinished(stack: number[]): void {
  for (;;) {
    const top = stack[stack.length - 1]
    if (top === undefined || top > 0) return
    stack.pop()
  }
}

/** Count this head as one item consumed from its parent container, if any. Mirrors `headers.ts`'s tokenizer. */
function decrementParent(stack: number[]): void {
  const top = stack[stack.length - 1]
  if (top !== undefined) {
    stack[stack.length - 1] = top - 1
  }
}

/**
 * Advance `state` as far as `data` (the bytes available so far) allows.
 *
 * Returns the envelope's byte length once `state.stack` empties, or
 * `undefined` if a complete structure can't be confirmed yet -- in which
 * case `state.cursor` is left at the start of whichever head is still
 * waiting on more bytes (at most 9 bytes: 1 head byte plus up to 8 length
 * bytes), so at most that much is ever re-read. Throws `MalformedEnvelopeError`
 * for anything this profile could never accept, without waiting for more
 * input first.
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
          `Malformed envelope: a ${major === 2 ? 'byte' : 'text'} string of ${value} bytes exceeds the ` +
            `${MAX_ENVELOPE_SIZE}-byte envelope budget.`
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

/** A view over `prefix[0, filledLength)` followed by `extra[0, extraLength)`, without concatenating them. */
function combinedView(
  prefix: Uint8Array,
  filledLength: number,
  extra: Uint8Array,
  extraLength: number
): ArrayLike<number> {
  const length = filledLength + extraLength
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'length') return length
        if (typeof prop !== 'string') return undefined
        const index = Number(prop)
        if (!Number.isInteger(index) || index < 0 || index >= length) return undefined
        return index < filledLength ? prefix[index] : extra[index - filledLength]
      },
    }
  ) as ArrayLike<number>
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
 * Create a scanner that buffers only what turns out to be envelope bytes --
 * never the ciphertext after it -- and decodes exactly once, on exactly the
 * right slice. Because that slice is copied into the scanner's own buffer,
 * the decoded result can't change if a caller later mutates a block it
 * already pushed.
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
    const extraLength = Math.max(0, Math.min(block.length, MAX_ENVELOPE_SIZE - filledBefore))
    const view = combinedView(buffer, filledBefore, block, extraLength)

    const length = scanEnvelopeStep(view, state)

    if (length === undefined) {
      // Not complete yet: everything offered so far might still be envelope,
      // so it's all committed -- never the caller's job to know the split.
      ensureCapacity(filledBefore + extraLength)
      buffer.set(block.subarray(0, extraLength), filledBefore)
      filled = filledBefore + extraLength
      if (filled >= MAX_ENVELOPE_SIZE) {
        throw new MalformedEnvelopeError(`Malformed envelope: exceeds the ${MAX_ENVELOPE_SIZE}-byte envelope limit.`)
      }
      return undefined
    }

    // Complete: only the confirmed envelope prefix of this block is copied in.
    const consumedFromBlock = length - filledBefore
    ensureCapacity(length)
    buffer.set(block.subarray(0, consumedFromBlock), filledBefore)
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
