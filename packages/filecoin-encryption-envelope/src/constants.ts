/**
 * Wire constants for the Filecoin Encryption Envelope (FIP-1253).
 *
 * Reference: https://github.com/filecoin-project/FIPs/discussions/1253
 * See docs/tech-spec.md in this package for the full wire profile and the
 * rationale behind each deliberate divergence from the FIP text.
 */

// ── COSE header labels (protected unless noted) ────────────────────────────

/** `alg`, RFC 9052 §3.1. Selects the encryption scheme, see the ALG_* constants. */
export const HEADER_ALG = 1
/** `content_type`, RFC 9052 §3.1. Media type of the plaintext. Optional. */
export const HEADER_CONTENT_TYPE = 3
/** `kid`, RFC 9052 §3.1. Not used at the top level in this profile; kept for recipients. */
export const HEADER_KID = 4
/** `iv`, RFC 9052 §3.1. Unprotected: 12-byte nonce (scheme 1) or 7-byte base nonce (chunked). */
export const HEADER_IV = 5
/** `typ`, RFC 9052 §3.1. Must equal {@link ENVELOPE_TYPE}. */
export const HEADER_TYP = 16

/**
 * `chunk_size`, algorithm-specific label per RFC 9052 §3.1. Required for the
 * chunked scheme, must not appear when `alg` is {@link ALG_AES_256_GCM} (3) —
 * whole-object AEAD has no chunk layout.
 */
export const HEADER_CHUNK_SIZE = -1

/**
 * `chunk_count`, private use (RFC 9052 §3.1). Present only when the content
 * length was known at encryption time. See docs/tech-spec.md, "chunk_count
 * and truncation" — this label lives in the *protected* header so an
 * attacker cannot edit it to mask a truncated object without failing every
 * chunk's AEAD tag.
 */
export const HEADER_CHUNK_COUNT = -65791
/** `app_metadata`, private use. Opaque, string-keyed map carried and authenticated but never interpreted. */
export const HEADER_APP_METADATA = -65792

// ── Algorithms ──────────────────────────────────────────────────────────────

/** Whole-object AES-256-GCM, one AEAD operation over the entire plaintext. Not seekable. */
export const ALG_AES_256_GCM = 3
/** Chunked AES-256-GCM with STREAM (per-chunk nonce, positional AAD binding). Seekable. */
export const ALG_CHUNKED_AES_256_GCM_STREAM = -65793

// ── Key wrap algorithms (RFC 9053) ──────────────────────────────────────────

/** AES key wrap, RFC 9053 §6.2.1. */
export const ALG_A256KW = -5
/** ECDH-ES + AES key wrap, HKDF-SHA-256, RFC 9053 §6.3.1. */
export const ALG_ECDH_ES_A256KW = -31

// ── CBOR tags ────────────────────────────────────────────────────────────────

/** `COSE_Encrypt0`, RFC 9052 §5.2. No recipients array; used when the CEK is out of band. */
export const TAG_ENCRYPT0 = 16
/** `COSE_Encrypt`, RFC 9052 §5.1. Carries a recipients array for key wrapping. */
export const TAG_ENCRYPT = 96

// ── Envelope identity ────────────────────────────────────────────────────────

/** `typ` header value identifying this envelope format. */
export const ENVELOPE_TYPE = 'application/vnd.filecoin-encryption+cose'

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

/** Default chunk size when the caller does not specify one. */
export const DEFAULT_CHUNK_SIZE = 262144
/** Smallest permitted chunk size. */
export const MIN_CHUNK_SIZE = 4096
/** Largest permitted chunk size. */
export const MAX_CHUNK_SIZE = 16777216

/**
 * Largest permitted chunk count.
 *
 * The per-chunk nonce reserves 4 bytes for the chunk index (see
 * docs/tech-spec.md, "Per-chunk nonce"), which could in principle count up
 * to 2^32 values. The FIP deliberately caps `chunk_count` one below that, at
 * 2^32 - 1, so we follow the spec's stated limit rather than the counter's
 * raw addressable range.
 */
export const MAX_CHUNK_COUNT = 4294967295
