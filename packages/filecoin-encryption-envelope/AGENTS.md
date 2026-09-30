# Filecoin Encryption Envelope

TypeScript implementation of the draft [FIP-1253](https://github.com/filecoin-project/FIPs/discussions/1253)
profile. Read `docs/implementation-guide.md` when changing the wire format, AAD, chunk layout, limits,
or public contracts.

## Code map

- `cose/`: envelope encoding, decoding, and header validation.
- `aes-gcm.ts`: whole-object encryption and decryption.
- `aes-gcm-stream.ts`: chunked encryption and decryption.
- `recipients/`: A256KW wrapping and unwrapping.
- `range/`: envelope inspection and authenticated range reads.
- `chunk-layout.ts` and `nonce.ts`: chunk arithmetic and nonce derivation.

## Scope

Callers own CEK generation and derivation, storage, HTTP access, and UX. This package accepts keys and
byte sources but does not manage those systems.

## Module layout and exports

`src/index.ts` defines the public API. Chunked streaming, envelope inspection, and range reads are
available at the root; whole-object encryption is under `aesGcm`. Public constants come from
`src/public-constants.ts`. Shared implementation code lives under `src/internal/` and is not exported.
`src/internal/web-crypto.ts` owns Web Crypto calls and error mapping; `src/internal/keys.ts` owns
key-shape validation.

Inside `src/`, import the specific file that owns a value rather than routing through public barrels.

Unit tests normally import the module under test directly. Tests of the public API import `src/index.ts`.

## Input ownership and validation

- Public async operations borrow caller input until the promise settles. Streaming options stay borrowed
  until the readable closes or errors; a written plaintext block may be reused once its `write()` resolves.
- Validate values at public and callback boundaries. Read each caller-owned property once; internal helpers
  use prepared values.
- Reject `SharedArrayBuffer`-backed views before Web Crypto. Import CEKs as non-extractable `CryptoKey`s
  unless wrapping requires extractability.
- Copy bytes passed to caller callbacks or kept beyond an operation. Process recipient key operations
  sequentially.

## Constants

Place constants by what they describe, not by how many modules import them. `src/constants.ts` holds
encryption scheme IDs and key, nonce, chunk, and object size limits. `src/cose/constants.ts` holds COSE
header labels, tags, recipient algorithm IDs, envelope type, and CBOR parsing limits, including values
used by `recipients/`.

`src/public-constants.ts` re-exports only constants callers need; it defines no values of its own.

## COSE wire rules

- Preserve the received protected-header byte string for AAD. Do not rebuild it from the decoded map:
  equivalent CBOR values can have different bytes.
- Decode through `decodeExact` or `decodeFirst` in `cose/headers.ts`, not cborg directly. Their shared
  policy keeps CBOR maps as `Map` and rejects duplicate keys, non-minimal integers, indefinite-length
  items, floats, `undefined`, bigints, invalid UTF-8, and excessive nesting. Byte-string map keys are
  compared by content.
- Pass cborg's `rfc8949EncodeOptions` to every encode call for stable output and byte-exact vectors.
  Authentication uses the protected bytes received, regardless of another encoder's key order.
- Use `CborValue` for validated CBOR data and `unknown` before validation. Decoded maps are `Map`;
  plain objects are supported as encoding inputs for application metadata.
- Limit the encoded envelope to 1 MiB (`MAX_ENVELOPE_SIZE`) before passing bytes to the CBOR decoder.
  Apply the same bound to any new decode entry point; checking size after parsing is too late.
- Treat parsed fields as untrusted. Successful content authentication covers the content protected
  headers, not the unprotected headers or recipient list as a whole. Reject malformed structures with
  an appropriate `EnvelopeError` that names the offending field and expected value.

## Validation with Zod

Use Zod for fixed envelope and recipient tuples, and for scalar schemas when it makes validation
clearer. Validate fields inside integer-keyed COSE maps and cross-field rules directly; do not convert
maps to objects just for Zod. Use a direct guard for a standalone `instanceof` check.

## Errors

Expected package failures use `EnvelopeError` subclasses in `src/errors.ts`. Errors from caller-provided
streams can propagate unchanged; key callback failures are wrapped by their APIs. Reuse an existing
subclass unless the failure is a new category. Input-validation messages name the offending field and
expected value; preserve the cause when wrapping an error.

## Code conventions

Follow Biome and TypeScript for formatting and syntax. Use `.ts` extensions on relative imports and
`import type` for type-only imports. Source and tests must run in browsers: avoid Node-only APIs and
`node:` imports.

## Testing

`pnpm test` runs build, lint, and tests in Node and a browser. Tests use the bundled `assert` package,
not `node:assert`. Put shared hex and byte vectors in `test/cose-fixtures.ts` and general test helpers
in `test/helpers.ts`.

For wire-format changes, pair round trips with independently derived, byte-exact vectors; encode and
decode can share the same bug. When testing preservation of received bytes, include valid encodings
the package's own encoder would not produce, such as a different map-key order.

Documentation-only edits do not need the source test suite.
