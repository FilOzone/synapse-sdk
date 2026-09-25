# Filecoin Encryption Envelope

TypeScript implementation of [FIP-1253](https://github.com/filecoin-project/FIPs/discussions/1253): a
COSE container pairing a self-describing metadata envelope with detached ciphertext.

**Read `docs/tech-spec.md` first.** It is the authoritative wire format, AAD construction, chunk-layout
math, and rationale for every deliberate divergence from the FIP text. This file is
about *how to work in this package* — conventions, module layout, and decisions already made — not the
wire format itself.

Status: draft, unpublished (`version: 0.0.0`). Nothing here is a public API commitment yet, so breaking
the export shape costs nothing — no downstream consumers exist.

Implemented: `chunk-layout.ts`, `nonce.ts`, the error hierarchy, the `cose/` wire layer (strict CBOR
parsing, tags 16/96, protected and unprotected headers, detached-ciphertext framing, `Enc_structure`,
structural recipient validation), scheme-1 AES-256-GCM encryption and decryption in `aes-gcm.ts` (direct
CEK, both tag 16 and tag 96), A256KW recipient wrapping on encryption, and the A256KW unwrap primitive.
Not yet implemented: recipient-based decryption, the chunked scheme and streaming, range reads, and
envelope inspection beyond decode. ECDH-ES+A256KW remains deferred; the code enforces its settled header
placement but does not derive or unwrap its KEK.

## Scope discipline

The package owns: envelope format (encode/decode), AEAD and AAD construction, chunk layout and
positional nonce derivation, key wrapping, and authenticated range decryption. This describes the final
package boundary, not what is already implemented. It does **not** own: where the CEK came from, key
derivation, storage/retrieval/HTTP, or any UX. See `docs/tech-spec.md`'s "Scope" table before adding
anything that looks like it belongs to a different concern.

## Module layout and exports

Each concern gets its own file or, once it grows past one file, its own directory with an `index.ts`
that defines that directory's public surface. Use `export *` when the whole module is public and
explicit exports when helpers must stay internal, as `cose/index.ts` does for `headers.ts`.

`src/index.ts` is the allowlist of this package's public interface: a module is public only if
`src/index.ts` exports it. Shared implementation code lives under `src/internal/` and is never exported.
Shared type-only exports at the root (currently `AppMetadata`, `CborValue`) are the one exception to
"namespaces only" — a type carries no runtime shape, so it doesn't need one. Public constants are
re-exported through the curated `src/public-constants.ts`, never `src/constants.ts` directly:

```ts
export * as aesGcm from './aes-gcm.ts'
export type { AppMetadata, CborValue } from './cose/headers.ts'
export * as cose from './cose/index.ts'
export * as errors from './errors.ts'
export * as constants from './public-constants.ts'
export * as recipients from './recipients/index.ts'
```

Inside `src/`, import the specific file that owns a value (`'../cose/headers.ts'`, for example);
internal modules do not need to route through public barrels or pull in a whole namespace for one
function.

Tests import the specific file under test directly (`'../src/cose/headers.ts'`), never through
`src/index.ts` — that keeps a test failure pointing at the module that actually changed, and it's also
what makes the root barrel's export *shape* freely changeable without touching any test. The one
exception is `test/public-surface.test.ts`, which tests the root barrel itself.

## Input ownership and validation

- Public async operations borrow caller input; callers must not modify any input (plaintext, encoded
  object, keys, recipient objects, metadata) until the promise settles. The library never modifies
  caller input and does not detect mutation.
- Validate once at each external seam (public functions, values returned by caller-supplied callbacks);
  internal functions trust prepared values and do not re-validate.
- Read each caller-object property once (getters can return different values per read).
- Raw key bytes are validated, then imported to a `CryptoKey`; only `CryptoKey`s travel inward. The CEK
  is imported once per operation, extractable only when it must be wrapped.
- Byte inputs handed to Web Crypto must be ArrayBuffer-backed; SharedArrayBuffer-backed views are
  rejected with the relevant input error.
- Copy only data handed to caller code (e.g. the recipient view given to an unwrapper), so the callback
  cannot alter the caller's encoded input.
- Recipient key operations run sequentially; never start one Web Crypto operation per recipient at once.
- Web Crypto calls live only in `src/internal/web-crypto.ts`, which owns error mapping; key-shape
  validation lives in `src/internal/keys.ts`.

## Constants: shared root file vs. module-local file

A constant goes in the package-level `src/constants.ts` when **more than one module needs the exact same
value, including a module that doesn't exist yet but is already designed** (see docs/tech-spec.md's API
section — a documented, not-yet-built consumer counts). It goes in `<module>/constants.ts` (e.g.
`src/cose/constants.ts`) when **only that module uses it, and nothing concrete on the horizon will need
it elsewhere**. This is the same rule `packages/synapse-core` follows — compare its `utils/constants.ts`
(imported from seven different directories: `errors`, `pay`, `piece`, `sp`, `sp-registry`, `warm-storage`,
`mocks`) against `piece/internal/constants.ts` (FR32/PieceCID math per FRC-0069, imported nowhere outside
`piece/`). Don't split preemptively for a *hypothetical* future consumer, though — that's future-proofing
without a concrete need, which the root CLAUDE.md's engineering principles already warn against.

Concretely here: `src/constants.ts` holds the scheme identifiers and shared size limits: key, nonce,
chunk, chunk-count, object-size, and scheme-1 plaintext bounds. `chunk-layout.ts`, `nonce.ts`, the COSE
header validator, and the future AEAD layer must use the same values. `cose/constants.ts` holds header
labels, CBOR tags, recipient algorithm IDs, `ENVELOPE_TYPE`, `MAX_ENVELOPE_SIZE`, and the CBOR nesting
limit — values meaningful only while shaping or parsing COSE.

`src/public-constants.ts` is a curated re-export list, not a second place to define values: it defines
nothing itself, only re-exports names already defined in `src/constants.ts` or `cose/constants.ts`. A new
constant is still placed by the shared-vs-module-local rule above regardless of whether it will end up
public — being defined somewhere does not make a constant public; add it to `public-constants.ts` only
when a caller actually needs it.

## Wire-format code conventions (`src/cose/`, and anything that follows it)

- **Never re-encode a decoded value to reconstruct wire bytes.** Every decode function that hands back
  bytes that feed an AAD or a signature (`DecodedProtectedHeader.bytes`, in particular) returns the
  literal protected byte string read from the input, not `encode(decodedValue)`. A re-encode is not
  guaranteed byte-identical to what a different encoder wrote (integer width, key order), and this
  class of bug is the exact one called out in `docs/tech-spec.md`'s AAD section.
- **Use the hardened decode helpers in `cose/headers.ts`.** `decodeExact` handles serialized protected
  maps; `decodeFirst` handles an envelope prefix followed by detached ciphertext. Both build the strict
  tokenizer internally and apply the same decoded-tree allowlist. Do not call cborg's bare `decode` or
  `decodeFirst` from another module.
- **cborg decode policy is centralized** in `DECODE_OPTIONS` and `createStrictTokenizer`: maps stay as
  `Map`; duplicate keys, non-minimal integers, indefinite-length items, `undefined`, bigint values,
  floats, invalid UTF-8, and excessive nesting are rejected. The post-decode walk limits map keys to
  supported scalar forms, compares byte-string keys by content, and rejects caller properties that CBOR
  would silently omit.
- **`useMaps: true` means every CBOR map decodes to a `Map`, never a plain object** — COSE header labels
  are integers (`1`, `-65792`, ...), and cborg's plain-object decode path rejects non-string keys
  outright. Do not switch a decode call to `useMaps: false` without re-deriving every downstream
  `.get()`/`instanceof Map` check.
- **Deterministic encoding**: pass cborg's `rfc8949EncodeOptions` explicitly to every `encode()` call.
  This gives stable package output and byte-exact vectors. Authentication does not require two encoders
  to emit the same bytes; a decoder authenticates the protected bytes it actually received.
- **`CborValue`, not `unknown`**, for anything that came from or is going to cborg. `CborValue`
  (`cose/headers.ts`) is a closed union of every shape this package's decode options can actually
  produce (`string | number | boolean | null | Uint8Array | CborValue[] | Map<CborValue, CborValue> |
  CborValueObject`). It is deliberately the *same* type on encode input and decode output — a value
  decoded once should be re-encodable without a cast. Reach for `unknown` only at a genuine "this could
  be absolutely anything, including non-CBOR things" boundary (e.g. `describeCborType`'s parameter, which
  also has to accept a caught `cause`) — that is the exception, not the default.
- **A 1 MiB (`MAX_ENVELOPE_SIZE`) ceiling on the *encoded envelope*, enforced by never handing the CBOR
  decoder more than that many bytes** (see `cose/decode.ts`'s truncated-prefix slice before calling
  `decodeFirst`), not by checking a result's length afterward. Checking after the fact is too late — the
  oversized allocation already happened. Any future decode entry point that reads attacker-controlled
  bytes needs the same bound-before-you-parse shape, not a post-hoc length check.
- **Decode is a security boundary; every field is hostile until an AEAD tag verifies it.** Reject
  duplicate map keys, non-minimal integer encodings, indefinite-length items, wrong array lengths, wrong
  CBOR tags, and anything not matching the exact profile in `docs/tech-spec.md` — no silent coercion, no
  defaulting a missing required field. Every rejection throws an appropriate `EnvelopeError`
  subclass, such as `MalformedEnvelopeError`, `UnsupportedSchemeError`, or `CriticalHeaderError`
  (`src/errors.ts`), naming the header label (in wire vocabulary: `alg (1)`, `chunk_size (-1)`) and
  what was expected, not a generic "invalid input."

## When to reach for zod (and when not to)

`zod` (`catalog:` in the workspace) is a dependency here. Use it for:

- **Structural/shape validation of arrays and tuples** — "this must be an array of exactly N elements,
  each of a specific type" is exactly `z.tuple([...])` / `z.array(...).min(n)`. See `cose/decode.ts`'s
  `TAG0_BODY_SCHEMA` / `TAG_BODY_SCHEMA` / `RECIPIENT_SCHEMA`, which replaced a `requireArray` +
  `.length` check + one `instanceof` per element with a single `.safeParse()`.
- **Multi-condition scalar checks that collapse into one declarative schema** — a union of literals
  (`alg`), a union of types (`content_type: tstr / uint`), or the `chunk_size` integer range. See the
  `*_SCHEMA` constants in `cose/headers.ts`. `plaintext_length` uses an explicit safe-integer check and
  chunk-layout arithmetic instead.

Do **not** reach for it for:

- **Validating the COSE header `Map`s themselves.** They are integer-keyed and heterogeneous (label `1`
  is a number, label `16` is a string, label `-65792` is a nested map) — zod's ergonomic object/
  discriminated-union validation assumes string-keyed plain objects. Converting a `Map` to a POJO just to
  satisfy zod, then back, adds an indirection layer without removing any of the imperative
  `map.get(LABEL)` extraction that still has to happen either way.
- **Cross-field presence rules** (`chunk_size` required when `alg` is the chunked scheme, forbidden
  otherwise). That is a relation between two fields already pulled out of the map, not a shape — a plain
  `if` is clearer than a discriminated union or `.refine()` here.
- **Replacing your own error messages.** When a zod schema *is* used, treat it as a boolean predicate
  (`schema.safeParse(x).success`) for a single-field check, and keep the hand-written message that names
  the header label and the actual value — that is what `docs/tech-spec.md`'s "every rejection must say
  which field failed" rule requires, and zod's own generic issue text doesn't know the wire vocabulary.
  For the `cose/decode.ts` tuple schemas (which validate a whole structural shape, not one field),
  `z.prettifyError(result.error)` folded into a contextual message is fine — see `parseBody()`.
- **A bare `instanceof` check that's already one line.** Wrapping `iv instanceof Uint8Array` in
  `z.instanceof(Uint8Array).safeParse(iv).success` is strictly worse: same runtime check, extra
  indirection, and it throws away TypeScript's control-flow narrowing (a boolean predicate doesn't narrow
  the checked variable the way a direct `instanceof` guard does).
- **`z.instanceof(Map)` when you need `Map<CborValue, CborValue>`.** It infers `Map<unknown, unknown>` —
  zod has no way to know what this package decodes a CBOR map's keys/values into. Use `z.custom<Map<
  CborValue, CborValue>>((v) => v instanceof Map, 'message')` instead (see `CBOR_MAP_SCHEMA` in
  `cose/decode.ts`) so `unknown` doesn't leak into inferred types.
- **Inlining `z.infer<typeof SOME_SCHEMA>` in a function signature.** Name it (`type RecipientTuple =
  z.infer<typeof RECIPIENT_SCHEMA>`) and use the name — same reasoning as not inlining any other
  non-trivial type.

## Errors

One flat hierarchy in `src/errors.ts`, all extending `EnvelopeError`. Every error that can leave a public
package operation must belong to it. A raw `Error` is acceptable only inside a library callback such as
the strict tokenizer, where the public decode operation catches and wraps it. Add a subclass only for a
genuinely new failure category; reuse an existing class otherwise. Messages state the offending
field/value and what was expected. Pass `{ cause }` when wrapping a cborg or zod failure.

## Conventions enforced by CI (biome + tsc), same as the rest of the monorepo

No semicolons, single quotes, kebab-case filenames, never `!` (use explicit checks), relative imports
carry `.ts`, `import type` for type-only imports (`verbatimModuleSyntax`), no enums / no parameter
properties (`erasableSyntaxOnly`), no Node built-ins anywhere in `src/` (`Buffer`, `fs`, `path`,
`process` — this package must run unmodified in a browser; tests may use `node:assert` and other Node
built-ins freely, since only `src/` ships to browsers).

## Testing

Mocha + `node:assert`, with focused test modules (`test/cose-*.test.ts` for the COSE layer).
`test/cose-fixtures.ts` holds shared hex/byte-building helpers and hand-derived byte constants — add to
it rather than duplicating a hand-derived vector across files.

For anything that produces wire bytes, round-trip tests are necessary but not sufficient (they pass even
when encode and decode share the same bug). Always pair them with:

- **At least one byte-exact vector per wire shape**, hand-derived from the CBOR spec — comments should
  show the derivation (major type, additional-info byte, length). It is fine to double-check the
  derivation by calling `cborg` directly in a scratch script while writing the test; the test itself must
  hardcode the resulting literal, never call this package's own encoder to produce its own "expected"
  value.
- **A decode test using bytes this package's own encoder would never produce** (different key order, a
  non-canonical but valid shape) wherever the property under test is "decode preserves what it was
  given," to prove the property doesn't only hold by accident of both sides agreeing.

For source or test changes, run `pnpm test` from this directory; Wireit runs build and lint first. A
documentation-only edit does not need the source test suite.
