/**
 * Values only meaningful while shaping or parsing the COSE structure itself:
 * header labels, key-wrap algorithm IDs, CBOR tags, the envelope `typ`, and
 * the two decode limits. Size bounds shared with the chunk arithmetic live
 * in `../constants.ts`; `CLAUDE.md` has the rule for choosing between them.
 *
 * FIP-1253: https://github.com/filecoin-project/FIPs/discussions/1253
 * Wire profile: docs/tech-spec.md
 */

// ── COSE header labels ─────────────────────────────────────────────────────
//
// Every content header this profile defines is protected. The v1 encoder
// emits no content unprotected parameters at all, so the unprotected map it
// writes is empty; a decoder still accepts unknown non-critical parameters
// there and ignores them.

/** `alg`, RFC 9052 §3.1. Selects the encryption scheme, see the ALG_* constants. */
export const HEADER_ALG = 1
/**
 * `crit`, RFC 9052 §3.1. Names header labels a processor must understand and
 * act on. For the acceptance rule see {@link CriticalHeaderError}.
 */
export const HEADER_CRIT = 2
/** `content_type`, RFC 9052 §3.1. Media type of the plaintext. Optional. */
export const HEADER_CONTENT_TYPE = 3
/** `kid`, RFC 9052 §3.1. Recipients only; a byte string. Never a content header in this profile. */
export const HEADER_KID = 4
/**
 * `iv`, RFC 9052 §3.1: a 12-byte nonce (scheme 1) or a 7-byte base nonce
 * (chunked).
 *
 * COSE permits either bucket. This profile requires the **protected** one so
 * the IV is covered by the content AAD, and rejects the label in the
 * unprotected map (FIP amendment 3).
 */
export const HEADER_IV = 5
/**
 * `Partial IV`, RFC 9052 §3.1. Forbidden in both content buckets.
 *
 * Rejected rather than ignored, unlike an unknown label. Partial IV means
 * "rebuild the nonce from this fragment plus shared context", and `iv` is
 * always present here — so the pair gives two conflicting instructions for
 * the same nonce with no rule for which wins. Our seven-byte base nonce is
 * not Partial IV reconstruction either; the missing bytes are the chunk
 * index and last-chunk flag, not shared context.
 *
 * A library decision, not an amendment: docs/tech-spec.md, "Library profile
 * decisions".
 */
export const HEADER_PARTIAL_IV = 6
/** `typ`, RFC 9052 §3.1. Must equal {@link ENVELOPE_TYPE}. */
export const HEADER_TYP = 16

/**
 * `chunk_size`, algorithm-specific label per RFC 9052 §3.1. Required for the
 * chunked scheme, must not appear when `alg` is {@link ALG_AES_256_GCM} (3) —
 * whole-object AEAD has no chunk layout.
 */
export const HEADER_CHUNK_SIZE = -1

/**
 * `plaintext_length`, private use (RFC 9052 §3.1). Optional; written only
 * when the caller knew the content length before the envelope was emitted.
 *
 * Being protected is what makes it a truncation check: an attacker can
 * neither edit it to match a short object nor strip it to escape the
 * comparison, since both change the AAD and fail every chunk tag.
 *
 * Do not renumber this to `-65791`: see docs/tech-spec.md,
 * "`plaintext_length` and truncation".
 */
export const HEADER_PLAINTEXT_LENGTH = -65789
/** `app_metadata`, private use. Opaque, string-keyed map carried and authenticated but never interpreted. */
export const HEADER_APP_METADATA = -65792

// ── Key wrap algorithms (RFC 9053) ──────────────────────────────────────────

/** AES key wrap, RFC 9053 §6.2.1. The only wrap this version supports. */
export const ALG_A256KW = -5
/**
 * ECDH-ES + AES key wrap. Deferred — defined here so recipients using it can
 * be recognised and skipped, not unwrapped.
 *
 * When that profile is written, the reference is RFC 9053 **§6.4** (key
 * agreement *with* key wrap), not §6.3 (direct key agreement).
 */
export const ALG_ECDH_ES_A256KW = -31

// ── CBOR tags ────────────────────────────────────────────────────────────────

/** `COSE_Encrypt0`, RFC 9052 §5.2. No recipients array; used when the CEK is out of band. */
export const TAG_ENCRYPT0 = 16
/** `COSE_Encrypt`, RFC 9052 §5.1. Carries a recipients array for key wrapping. */
export const TAG_ENCRYPT = 96

// ── Envelope identity ────────────────────────────────────────────────────────

/** `typ` header value identifying this envelope format. */
export const ENVELOPE_TYPE = 'application/vnd.filecoin-encryption+cose'

// ── Envelope decode limits ──────────────────────────────────────────────────

/**
 * Ceiling on the encoded envelope alone, not the detached ciphertext after
 * it.
 *
 * Enforced by never handing the CBOR decoder more than this many bytes (see
 * `decode.ts`), so a declared item length claiming gigabytes cannot force
 * the allocation — the bytes to satisfy it are simply not there. Checking
 * the result afterwards would be too late.
 */
export const MAX_ENVELOPE_SIZE = 1048576 // 1 MiB

/**
 * How deep the allowlist walk in `headers.ts` will descend into an
 * `app_metadata` value or a recipient's unprotected map, on encode and
 * decode alike.
 *
 * A library resource limit, not a COSE or FIP rule: it turns a stack
 * overflow into a package error.
 */
export const MAX_APP_METADATA_DEPTH = 256
