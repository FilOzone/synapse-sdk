/**
 * Constants shared beyond `cose/`: the two scheme identifiers and the size
 * bounds that `chunk-layout.ts`, `nonce.ts` and `cose/headers.ts` must all
 * agree on byte-for-byte. Labels, tags and other COSE-only values live in
 * `cose/constants.ts`; `CLAUDE.md` has the rule for choosing between them.
 *
 * FIP-1253: https://github.com/filecoin-project/FIPs/discussions/1253
 * Wire profile and rationale: docs/tech-spec.md
 */

// ── Algorithms ──────────────────────────────────────────────────────────────

/** Whole-object AES-256-GCM, one AEAD operation over the entire plaintext. Not seekable. */
export const ALG_AES_256_GCM = 3
/** Chunked AES-256-GCM with STREAM (per-chunk nonce, positional AAD binding). Seekable. */
export const ALG_CHUNKED_AES_256_GCM_STREAM = -65793

// ── Sizes, in bytes ──────────────────────────────────────────────────────────

/** GCM authentication tag size. */
export const TAG_SIZE = 16
/** Content encryption key size (AES-256). */
export const KEY_SIZE = 32
/** Random, per-object portion of the chunked scheme's nonce. */
export const BASE_NONCE_SIZE = 7
/** Full AEAD nonce size (GCM standard). */
export const NONCE_SIZE = 12

// ── Chunk size limits, in plaintext bytes per chunk ─────────────────────────

export const DEFAULT_CHUNK_SIZE = 262144 // 256 KiB
export const MIN_CHUNK_SIZE = 4096 // 4 KiB
export const MAX_CHUNK_SIZE = 16777216 // 16 MiB

/**
 * Largest chunk count the wire profile permits: 2^32 - 1. Indices start at
 * zero and end at `chunkCount - 1`, so the 32-bit counter never wraps.
 * The 64 GiB encoded-object limit binds much earlier for every legal chunk
 * size.
 */
export const MAX_CHUNK_COUNT = 4294967295

// ── Object size limits, in bytes ────────────────────────────────────────────

/**
 * Largest complete encoded chunked object: envelope plus detached
 * ciphertext, every 16-byte chunk tag included.
 *
 * Enforcing it needs both lengths, so it belongs to whichever layer holds
 * the total blob size. `chunkLayout` sees only the ciphertext and can apply
 * it as a necessary condition, no more.
 */
export const MAX_ENCODED_OBJECT_SIZE = 68719476736 // 64 GiB

/**
 * Largest plaintext the one-shot AES-256-GCM scheme accepts.
 *
 * Memory sets this number, not cryptography: NIST allows nearly 64 GiB per
 * GCM message. But scheme 1 cannot stream — one tag covers the whole
 * ciphertext, so decrypting holds the input, the output and Web Crypto's
 * internal copy at the same time, roughly 3x the plaintext. Runtime
 * allocation ceilings differ and cannot be queried, so this sits well under
 * all of them. Larger objects use the chunked scheme, which is flat in
 * memory.
 *
 * Raise it only with measurements, and never lower it: raising accepts
 * inputs older versions rejected, lowering breaks callers that work today.
 */
export const MAX_AES_GCM_PLAINTEXT_SIZE = 67108864 // 64 MiB
