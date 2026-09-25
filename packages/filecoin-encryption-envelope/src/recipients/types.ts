import type { ALG_A256KW } from '../cose/constants.ts'
import type { CborValue } from '../cose/headers.ts'

/** Input for a recipient whose CEK is wrapped with a shared AES-256 KEK. */
export interface A256KWRecipient {
  readonly alg: typeof ALG_A256KW
  /** 32 bytes, not all-zero. The caller owns its lifecycle and reuse policy. */
  readonly kek: Uint8Array
  /** Optional key identifier written to recipient header label 4 (`kid`). */
  readonly kid?: Uint8Array
}

/** Recipient input accepted by high-level encryption functions. */
export type Recipient = A256KWRecipient

/** A caller-held AES-256 KEK for unwrapping A256KW recipients. */
export interface A256KWKey {
  readonly kek: Uint8Array
  readonly kid?: Uint8Array
}

/** Options for {@link createA256KWUnwrapper}. */
export interface A256KWUnwrapperOptions {
  /** Maximum AES-KW unwrap operations per unwrapper call. Positive safe integer; default 64. */
  readonly maxAttempts?: number
}

/** Validated recipient data exposed to key-unwrapping adapters. */
export interface RecipientInfo {
  /** Position in the envelope's recipient array. */
  readonly index: number
  readonly alg: number | string
  readonly kid?: Uint8Array
  /** Exact serialized protected-header bytes, needed by algorithms such as `-31`. */
  readonly protectedBytes: Uint8Array
  /** Decoded protected recipient parameters. */
  readonly protected: ReadonlyMap<number | string, CborValue>
  /** Decoded unprotected recipient parameters. */
  readonly unprotected: ReadonlyMap<number | string, CborValue>
  /** Wrapped CEK stored in the recipient ciphertext field. */
  readonly wrappedKey: Uint8Array
}

/**
 * Recover a CEK from an ordered, structurally validated recipient list.
 *
 * Return `undefined` when none of the recipients can be handled. Throwing
 * aborts key recovery; `decryptWith` reports it as `RecipientUnwrapError`
 * with the original error as its cause.
 */
export type Unwrapper = (recipients: readonly RecipientInfo[]) => Promise<Uint8Array | undefined>
