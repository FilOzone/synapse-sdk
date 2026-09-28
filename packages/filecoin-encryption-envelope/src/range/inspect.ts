/**
 * Unauthenticated envelope inspection. `parse()` reads just enough of a
 * source to report scheme, headers, and recipients, and -- for the chunked
 * scheme -- caches parameters range decryption can reuse instead of
 * re-reading the envelope. See docs/tech-spec.md's `parse`/`EnvelopeInfo`/
 * `ChunkedEnvelopeParams` block and "Cached chunked-envelope parameters".
 *
 * Nothing here is authenticated. Content type, application metadata,
 * recipients, and every size come from CBOR structure alone; none of it is
 * trustworthy until an AEAD tag over the relevant chunk verifies it.
 *
 * `ChunkedEnvelopeParams` only saves a re-read of the envelope: it must be
 * used against the same immutable object version it was read from. A
 * mismatch isn't guaranteed to be caught: most fail authentication, but
 * versions that differ only outside the protected header and the chunks read
 * can still decrypt. Params exist only in memory; persisting or restoring
 * them is out of scope here.
 */
import { ALG_AES_256_GCM } from '../constants.ts'
import type { DecodedEnvelope } from '../cose/decode.ts'
import type { AppMetadata } from '../cose/headers.ts'
import { MalformedEnvelopeError } from '../errors.ts'
import { toRecipientInfo } from '../recipients/info.ts'
import type { RecipientInfo } from '../recipients/types.ts'
import { type RandomAccessSource, readEnvelope, toRandomAccessSource } from './source.ts'

/** Cached values from one chunked envelope's protected header, for range decryption to reuse. */
export interface ChunkedEnvelopeParams {
  readonly scheme: 'chunked'
  /** Byte length of the envelope: where the detached ciphertext begins. */
  readonly headerLength: number
  readonly chunkSize: number
  readonly plaintextLength?: number
}

interface EnvelopeInfoBase {
  contentType?: string | number
  appMetadata?: AppMetadata
  /** Isolated copies; empty for a tag-16 (`COSE_Encrypt0`) object. */
  recipients: RecipientInfo[]
}

/** Only the chunked scheme carries `params`: scheme 1 is decrypted as one complete object, never by range. */
export type EnvelopeInfo =
  | (EnvelopeInfoBase & { scheme: 'aes-gcm' })
  | (EnvelopeInfoBase & { scheme: 'chunked'; params: ChunkedEnvelopeParams })

/** The decoded envelope a `ChunkedEnvelopeParams` was created from. */
export interface ParamsState {
  decoded: DecodedEnvelope
}

/**
 * Registers every `ChunkedEnvelopeParams` this module has created, keyed by
 * object identity. This is what makes params library-created rather than
 * merely shaped like one: a look-alike object with the same public fields
 * was never put here, so {@link paramsState} rejects it.
 */
const paramsRegistry = new WeakMap<object, ParamsState>()

/**
 * Look up the decoded envelope behind a `ChunkedEnvelopeParams`, for range
 * decryption to reuse instead of decoding again.
 */
export function paramsState(params: unknown): ParamsState {
  const state = typeof params === 'object' && params !== null ? paramsRegistry.get(params) : undefined
  if (state === undefined) {
    throw new MalformedEnvelopeError(
      'Invalid chunked envelope params: must come from parse(), not a look-alike object.'
    )
  }
  return state
}

function createChunkedParams(decoded: DecodedEnvelope): ChunkedEnvelopeParams {
  const { chunkSize, plaintextLength } = decoded.protectedHeader
  if (chunkSize === undefined) {
    throw new Error('unreachable: the chunked alg always carries chunk_size')
  }
  const params: ChunkedEnvelopeParams = Object.freeze({
    scheme: 'chunked' as const,
    headerLength: decoded.envelopeLength,
    chunkSize,
    ...(plaintextLength === undefined ? {} : { plaintextLength }),
  })
  paramsRegistry.set(params, { decoded })
  return params
}

/**
 * Inspect an encoded FEE object without a key: scheme, content type,
 * application metadata, and recipients. Unauthenticated -- see above.
 *
 * Reads only as much of `source` as it takes to find the envelope boundary
 * (see `readEnvelope`), never the detached ciphertext.
 */
export async function parse(source: Uint8Array | RandomAccessSource): Promise<EnvelopeInfo> {
  const decoded = await readEnvelope(toRandomAccessSource(source))
  const { alg, contentType, appMetadata } = decoded.protectedHeader

  const base: EnvelopeInfoBase = {
    ...(contentType === undefined ? {} : { contentType }),
    ...(appMetadata === undefined ? {} : { appMetadata }),
    recipients: decoded.recipients.map(toRecipientInfo),
  }

  if (alg === ALG_AES_256_GCM) {
    return { ...base, scheme: 'aes-gcm' }
  }
  // decodeEnvelope accepts only ALG_AES_256_GCM or the chunked alg.
  return { ...base, scheme: 'chunked', params: createChunkedParams(decoded) }
}
