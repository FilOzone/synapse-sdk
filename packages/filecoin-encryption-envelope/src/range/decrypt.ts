/**
 * Authenticated range decryption for the chunked scheme: fetch and decrypt
 * only the chunks a byte range touches. See docs/tech-spec.md's
 * `decryptRange`/`RangeResult` block and "Random-access source contract".
 */
import { ALG_CHUNKED_AES_256_GCM_STREAM, TAG_SIZE } from '../constants.ts'
import type { DecodedEnvelope } from '../cose/decode.ts'
import { encStructure } from '../cose/enc-structure.ts'
import { describeCborType } from '../cose/headers.ts'
import { InvalidSourceLengthError, MalformedEnvelopeError, UnsupportedSchemeError } from '../errors.ts'
import { assertAes256Key } from '../internal/keys.ts'
import { aesGcmDecrypt, importAesGcmKey } from '../internal/web-crypto.ts'
import { deriveChunkNonce } from '../nonce.ts'
import { recoverCek } from '../recipients/recover.ts'
import type { Unwrapper } from '../recipients/types.ts'
import { type ChunkedEnvelopeParams, paramsState } from './inspect.ts'
import { type ByteRange, planRange, type RangePlan } from './plan.ts'
import {
  type ExactRangeReader,
  openExactRange,
  type RandomAccessSource,
  readEnvelope,
  toRandomAccessSource,
} from './source.ts'

export interface RangeResult {
  /** Plaintext for the requested range, one authenticated chunk at a time. */
  stream: ReadableStream<Uint8Array>
  /** Bytes `stream` will emit: `Content-Length` for this response. */
  rangeLength: number
  /** The whole object's plaintext length: `Content-Range` total. */
  totalPlaintextLength: number
  /** What will actually be fetched from `source`: absolute bytes, envelope included. */
  ciphertextSpan: { offset: number; length: number }
  /**
   * Whether the requested span includes the object's presumed final chunk.
   * Its `last_flag` is authenticated once that chunk is actually read from
   * `stream` -- this field alone doesn't prove the object wasn't truncated.
   */
  includesFinalChunk: boolean
}

interface RangeDecryptOptions {
  params?: ChunkedEnvelopeParams
}

function readParams(options: RangeDecryptOptions | undefined): ChunkedEnvelopeParams | undefined {
  if (options === undefined) return undefined
  // An array passes typeof 'object' but isn't a valid options shape.
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new MalformedEnvelopeError(
      `Invalid range decryption options: expected an object, got ${describeCborType(options)}.`
    )
  }
  const { params } = options
  return params
}

/**
 * Assemble one ciphertext piece at a time from `reader`: a zero-copy
 * `subarray` when a single block covers the whole piece, otherwise copied
 * into a scratch buffer (sized to the largest possible piece, one stride)
 * across blocks. Any unused tail of a block is held for the next piece.
 */
function createPieceReader(reader: ExactRangeReader, stride: number) {
  let heldBlock: Uint8Array<ArrayBuffer> | undefined
  let heldOffset = 0
  // Allocated only once a piece spans blocks; contiguous sources never need it.
  let scratch: Uint8Array<ArrayBuffer> | undefined

  async function nextBlock(): Promise<Uint8Array<ArrayBuffer>> {
    if (heldBlock !== undefined && heldOffset < heldBlock.length) return heldBlock
    const block = await reader.read()
    if (block === undefined) {
      throw new InvalidSourceLengthError(
        'Invalid range source: the opened range ended before its planned bytes were fully read.'
      )
    }
    heldBlock = block
    heldOffset = 0
    return block
  }

  async function readPiece(pieceLength: number): Promise<Uint8Array<ArrayBuffer>> {
    let filled = 0
    for (;;) {
      const block = await nextBlock()
      const available = block.length - heldOffset
      if (filled === 0 && available >= pieceLength) {
        // Zero-copy: nothing copied yet, and this block alone covers it.
        const view = block.subarray(heldOffset, heldOffset + pieceLength) as Uint8Array<ArrayBuffer>
        heldOffset += pieceLength
        return view
      }
      const take = Math.min(available, pieceLength - filled)
      scratch ??= new Uint8Array(stride)
      scratch.set(block.subarray(heldOffset, heldOffset + take), filled)
      filled += take
      heldOffset += take
      if (heldOffset === block.length) {
        heldBlock = undefined
        heldOffset = 0
      }
      if (filled === pieceLength) {
        return scratch.subarray(0, pieceLength) as Uint8Array<ArrayBuffer>
      }
    }
  }

  return { readPiece }
}

interface KeyedRangePlan {
  cekKey: CryptoKey
  /** The `Enc_structure` AAD, shared by every chunk in this range. */
  additionalData: Uint8Array<ArrayBuffer>
  /** The envelope's IV; each chunk's nonce derives from this plus its index. */
  baseNonce: Uint8Array
}

/**
 * The range's output stream. Opens `plan.ciphertextSpan` on the first pull
 * (not before), reassembles each planned chunk piece, and releases its
 * plaintext only once that chunk's own tag verifies.
 */
function createRangeStream(
  source: RandomAccessSource,
  plan: RangePlan,
  chunkSize: number,
  keyed: KeyedRangePlan
): ReadableStream<Uint8Array> {
  const stride = chunkSize + TAG_SIZE
  let opened: { reader: ExactRangeReader; pieces: ReturnType<typeof createPieceReader> } | undefined
  let index = plan.firstChunk
  let remainingToEmit = plan.rangeLength

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let reader: ExactRangeReader | undefined
        try {
          if (opened === undefined) {
            const newReader = openExactRange(source, plan.ciphertextSpan.offset, plan.ciphertextSpan.length)
            opened = { reader: newReader, pieces: createPieceReader(newReader, stride) }
          }
          reader = opened.reader

          const isLastPiece = index === plan.lastChunk
          const pieceLength = isLastPiece ? plan.lastChunkCipherLength : stride
          const piece = await opened.pieces.readPiece(pieceLength)

          // The size-derived layout decides finality, never "last piece of this span".
          const isFinalChunk = index === plan.chunkCount - 1
          const nonce = deriveChunkNonce(keyed.baseNonce, index, isFinalChunk)
          // Decrypt before reading again: `piece` may be a view into a block
          // the source could reuse or overwrite on the next read.
          let plaintext = await aesGcmDecrypt(keyed.cekKey, nonce, keyed.additionalData, piece)

          if (isLastPiece) {
            // Confirms the source has nothing left beyond the planned span,
            // before this final piece's plaintext is ever released.
            const extra = await reader.read()
            if (extra !== undefined) {
              throw new InvalidSourceLengthError('Invalid range source: produced extra bytes beyond the planned span.')
            }
          }

          if (index === plan.firstChunk && plan.skip > 0) {
            plaintext = plaintext.subarray(plan.skip)
          }
          if (plaintext.length > remainingToEmit) {
            plaintext = plaintext.subarray(0, remainingToEmit)
          }
          remainingToEmit -= plaintext.length

          if (plaintext.length > 0) {
            controller.enqueue(plaintext)
          }
          index++
          if (isLastPiece) {
            controller.close()
          }
        } catch (cause) {
          await reader?.cancel(cause)
          throw cause
        }
      },
      cancel(reason) {
        return opened?.reader.cancel(reason)
      },
    },
    { highWaterMark: 0 }
  )
}

/**
 * Shared steps for `decryptRange` and `decryptRangeWith`: resolve the source
 * and envelope, plan the range, resolve the key, and hand back a
 * `RangeResult` before any ciphertext is opened.
 */
async function createRangeResult(
  source: Uint8Array | RandomAccessSource,
  range: unknown,
  options: RangeDecryptOptions | undefined,
  getCekKey: (decoded: DecodedEnvelope) => Promise<CryptoKey>
): Promise<RangeResult> {
  const randomAccessSource = toRandomAccessSource(source)
  const params = readParams(options)

  // With params, the envelope is never read: `paramsState` hands back the
  // one this package already decoded when it created them.
  const decoded = params === undefined ? await readEnvelope(randomAccessSource) : paramsState(params).decoded
  if (decoded.protectedHeader.alg !== ALG_CHUNKED_AES_256_GCM_STREAM) {
    throw new UnsupportedSchemeError(
      `Unsupported content algorithm ${decoded.protectedHeader.alg}: range decryption requires alg ${ALG_CHUNKED_AES_256_GCM_STREAM}.`
    )
  }
  const { chunkSize, plaintextLength } = decoded.protectedHeader
  if (chunkSize === undefined) {
    throw new Error('unreachable: the chunked alg always carries chunk_size')
  }

  const plan = planRange(
    { sourceSize: randomAccessSource.size, headerLength: decoded.envelopeLength, chunkSize, plaintextLength },
    range
  )

  const cekKey = await getCekKey(decoded)
  const additionalData = encStructure(decoded.tag, decoded.protectedHeader.bytes)
  // Copied: retained for every chunk over the life of the stream.
  const baseNonce = new Uint8Array(decoded.protectedHeader.iv)

  return {
    stream: createRangeStream(randomAccessSource, plan, chunkSize, { cekKey, additionalData, baseNonce }),
    rangeLength: plan.rangeLength,
    totalPlaintextLength: plan.totalPlaintextLength,
    // A copy: the stream opens `plan.ciphertextSpan` later, so a caller
    // editing this field must not change what gets fetched.
    ciphertextSpan: { ...plan.ciphertextSpan },
    includesFinalChunk: plan.includesFinalChunk,
  }
}

/**
 * Decrypt one byte range of a chunked object using a direct CEK.
 *
 * The promise settles with every result field -- `rangeLength`,
 * `totalPlaintextLength`, `ciphertextSpan`, `includesFinalChunk` -- known
 * before any ciphertext is fetched, so a caller can send response headers
 * first. `ciphertextSpan` is one contiguous request, opened lazily on the
 * stream's first read; each chunk's plaintext is released only after its own
 * tag verifies.
 *
 * `cek` is borrowed until this promise settles; `source` is borrowed until
 * `stream` closes or errors. Pass `options.params` from `parse()` on this
 * same object version to skip re-reading the envelope. A mismatch isn't
 * guaranteed to be caught: most fail authentication, but versions that differ
 * only outside the protected header and the chunks read can still decrypt.
 *
 * Truncation: a declared `plaintext_length` catches a size mismatch before
 * any fetch. A range that includes the presumed final chunk catches
 * truncation via that chunk's authenticated `last_flag`. A range stopping
 * short of the end, on an object with neither, can't tell.
 *
 * If `stream` errors, discard everything already read from it.
 */
export async function decryptRange(
  source: RandomAccessSource | Uint8Array,
  cek: Uint8Array,
  range: ByteRange,
  options?: RangeDecryptOptions
): Promise<RangeResult> {
  assertAes256Key(cek, 'CEK')
  return createRangeResult(source, range, options, () => importAesGcmKey(cek, 'decrypt', false))
}

/**
 * Like `decryptRange`, but recovers the CEK from the envelope's recipients
 * through `unwrapper`.
 *
 * - Tag 96 only: a tag-16 object fails with `NoUsableRecipientError` without
 *   calling `unwrapper`.
 * - `unwrapper` is called once, with copies of every recipient in wire order,
 *   also when `options.params` skips the envelope read; its CEK is validated.
 * - The range is planned first and the key recovered before the promise
 *   settles, so recipient failures reject it, never the stream.
 */
export async function decryptRangeWith(
  source: RandomAccessSource | Uint8Array,
  unwrapper: Unwrapper,
  range: ByteRange,
  options?: RangeDecryptOptions
): Promise<RangeResult> {
  if (typeof unwrapper !== 'function') {
    throw new MalformedEnvelopeError(`Invalid unwrapper: expected a function, got ${describeCborType(unwrapper)}.`)
  }
  return createRangeResult(source, range, options, async (decoded) => {
    const cek = await recoverCek(decoded, unwrapper)
    return importAesGcmKey(cek, 'decrypt', false)
  })
}
