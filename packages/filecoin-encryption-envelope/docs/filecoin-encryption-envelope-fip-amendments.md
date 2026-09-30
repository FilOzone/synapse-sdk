# Proposed amendments to the Filecoin Encryption Envelope FIP

---

<aside>
💡

**Status:** Proposal for discussion, not an adopted specification  

**Author:** Natalie

**Last updated:** September 22, 2026

**Reviewed by:**

- Kuba - September 21, 2026

</aside>

Source: [Filecoin Encryption Envelope FIP](https://github.com/filecoin-project/FIPs/discussions/1253). These amendments concern the FIP, not the library API or its current implementation. They retain both encryption schemes, the FEE type string, protected application metadata, and `envelope ‖ ciphertext` storage. Chunk count is still derived from ciphertext length; no stored count is added. For chunked objects whose length is known before encryption, amendment 4 adds an optional protected `plaintext_length` commitment.

The aim is to correct the FIP and state its format choices, not repeat the COSE specifications. MUST and SHOULD below describe proposed requirements.

Each amendment identifies a **correction** to an error, a **clarification** of unclear wording, or a **profile decision** that the FIP authors need to approve. A profile is the subset of COSE rules and options chosen for FEE. In proposed requirements, MUST means required, SHOULD or RECOMMENDED means recommended with justified exceptions, and MAY means permitted. These words do not mean the current FIP already contains those rules.

## COSE terms used here

COSE defines containers for encrypted data and the information needed to use it. FEE needs only part of COSE, not every message type or algorithm.

- **CBOR and CDDL:** CBOR is the binary format used for the envelope. CDDL describes the allowed structure and types. In examples, `bstr` is a byte string, `tstr` is text, and `h''` is a byte string containing no bytes.
- **Headers and labels:** headers are maps of parameters. Their keys are called labels; for example, label `1` means `alg`, the algorithm identifier.
- **Protected and unprotected headers:** both are readable without a key. Protected headers are included in a cryptographic calculation so changes can be detected. They are not encrypted. COSE also calls these two maps “buckets.”
- **Content and recipient layers:** the content layer encrypts the file with the content encryption key (**CEK**). A recipient record describes how to obtain that CEK, usually by decrypting a wrapped copy with a key-encryption key (**KEK**). Recipient headers have their own rules, separate from content headers.
- **Authentication tag and AAD:** AES-GCM produces encrypted bytes and a tag used to detect tampering. Additional authenticated data (**AAD**) is checked by the tag but is not encrypted. This combination is called authenticated encryption with associated data (**AEAD**). COSE calls the structure used to build content AAD `Enc_structure`.
- **Key derivation:** a key derivation function (**KDF**) produces a key from secret input and context. `COSE_KDF_Context` is COSE’s structure for that context. It is different from content AAD.

## 1. Correct recipient header placement

Affects **Multi-Recipient Support**, lines 327–339.

The FIP currently requires `alg` in every recipient's protected header. That placement is wrong for A256KW, but useful for ECDH-ES+A256KW because the protected bytes are part of its key derivation. Replace the blanket rule with:

> Each recipient MUST identify its key-distribution algorithm using `alg`. Header placement and processing MUST follow that algorithm's COSE requirements.
>

> For A256KW (`-5`), the recipient protected field MUST be a zero-length byte string, and `alg` MUST be in the unprotected map. A key identifier `kid` (label `4`, a byte string) is RECOMMENDED when needed to identify the wrapping key (key-encryption key).
>
>
> For FEE recipients using ECDH-ES+A256KW (`-31`), `alg` MUST be in the recipient protected map and MUST NOT be in its unprotected map. The original serialized protected bytes MUST be included in `COSE_KDF_Context` as required by RFC 9052 §8.5.5 and RFC 9053 §5.2. The content envelope's protected bytes cannot be used in their place.
>

The two recipient forms look like this in readable CBOR notation:

```
[h'', {1: -5, 4: key_identifier}, wrapped_cek]
[h'a101381e', {-1: ephemeral_public_key, 4: recipient_key_identifier}, wrapped_cek]
```

Here `h''` means no bytes, not an encoded empty map. In the second example, `h'a101381e'` is the serialized map `{1: -31}`. The ephemeral public key is a `COSE_Key`; identifiers and the wrapped CEK are byte strings.

The A256KW placement comes from COSE. Protected `alg = -31` is a proposed FEE profile choice: COSE requires `alg` in the recipient layer and uses that layer's protected bytes in the KDF context, but does not require `alg` to be protected. Fixing its location makes those KDF bytes unambiguous across implementations.

Remove the recipient CDDL comment that always puts the algorithm in the protected field. Use the algorithm-dependent grammar in amendment 5. Curves, the remaining KDF inputs, and other recipient parameters still belong to the ECDH recipient profile.

References: [RFC 9052 §§8.5.2 and 8.5.5](https://www.rfc-editor.org/rfc/rfc9052), [RFC 9053 §§5.2 and 6.4.1](https://www.rfc-editor.org/rfc/rfc9053).

## 2. **Correct nonce guidance without choosing key management**

Affects **Content Encryption Key Requirements**, lines 361–369, and **Nonce uniqueness**, lines 451–458.

Keep the recommendation for a CEK unique to each encrypted object. Leave the method of generating or deriving that key to the key-management system.

Replace the existing nonce-security paragraph with:

> A CEK unique to each encrypted object is RECOMMENDED. Leave CEK generation and derivation to the key-management system.

AES-GCM requires a distinct key/nonce pair for each encryption operation. All chunks of one FEE encryption use the same CEK, with distinct per-chunk nonces; the counter MUST NOT wrap.
>
>
> If a CEK is reused across encryption attempts, the key-management system remains responsible for nonce uniqueness and per-key usage limits.
>
> Scheme 1 uses a randomly generated 12-byte nonce. Scheme 2 uses a randomly generated 7-byte base nonce and derives a distinct 12-byte AES-GCM nonce for each chunk using the chunk index and final-chunk flag. The counter MUST NOT wrap. Chunks within one Scheme 2 encryption are not separate random nonce draws.
>

### Open choice: CEKs across encryption attempts

Approaches that can be supported by a separate key-management profile:

**Option A — reproducible, object-based CEKs.** Retain the FIP's suggestion to derive a CEK from a master key and an object identifier, such as `CEK = KDF(master_key, plaintext_CID)`. This makes the CEK recoverable from the same inputs, but encrypting the same object again normally reuses that CEK. A key-management profile choosing this option must define its KDF inputs, nonce-reuse policy, and per-key usage budget across all writers, retries, aborted attempts, chunks, and bytes.

**Option B — a fresh CEK for each whole-object encryption attempt.** Generate a random CEK or derive one using context that changes for every attempt, including retries of the same plaintext. This prevents the 56-bit nonce-collision risk from accumulating across attempts under one CEK, but the CEK can no longer be recovered from only the same master key and plaintext CID; it must be wrapped, stored, or reproducible from an additional attempt identifier. The FIP leaves this choice open to the key-management profile. Under either option, one CEK is used for all chunks of an attempt; a separate CEK per chunk is not required.

Neither approach waives AES-GCM's requirements. An identical plaintext CID alone does not guarantee an identical encryption operation: protected metadata, its encoding, the envelope type, or chunking may differ. Repeating identical key, nonce, plaintext, and AAD gives identical output; changing AAD can change the tag even when the encrypted payload stays the same.

Retransmitting stored ciphertext is not another encryption operation. Keep the existing CEK length, all-zero-key rejection, and cleanup requirements. Separately document supported GCM usage limits for large objects; a counter capable of addressing about 1 PiB does not establish that this is a safe per-key workload.

Reference: [RFC 9053 §4.1.1](https://www.rfc-editor.org/rfc/rfc9053#section-4.1.1).

## 3. **Put the content IV in the protected header**

Affects **Protected Headers**, **Unprotected Headers**, lines 184–192, both scheme descriptions, and the CDDL.

COSE permits the IV in the protected header. Protected headers are readable before authentication, so the decryptor can obtain the IV before checking the tag. Following Kuba's suggestion, the FEE profile should use that placement:

> The content `iv` parameter (label `5`) MUST appear in the protected header and MUST NOT appear in the unprotected header. It contains a randomly generated 12-byte nonce for scheme 1 or a randomly generated seven-byte nonce for the chunked STREAM scheme. The chunked scheme expands that value into each chunk's 12-byte AES-GCM nonce using the chunk index and finality flag.
>

Add label `5` to the protected-header table and map definition. The content unprotected map may be empty. Apply the same placement in both scheme descriptions, the CDDL, examples, and test vectors.

The IV becomes part of the serialized protected headers and therefore part of the content AAD. Moving it changes the envelope bytes and authentication tags, so an existing encrypted object cannot be converted by moving the field alone.

Reference: [RFC 9052 §3.1](https://www.rfc-editor.org/rfc/rfc9052#section-3.1).

## 4. Define chunk **boundaries,  plaintext length and range-read guarantees**

Affects ****Protected Headers****, ****Scheme 2****, especially lines 245–319, ****Chunk size and authentication granularity****, lines 460–466, and the CDDL.

The chunked scheme MUST use one unambiguous representation for the final chunk:

> Empty plaintext MUST produce one empty final chunk at index zero, with `last_flag = 0x01`. Its ciphertext consists of the 16-byte authentication tag. A zero-byte ciphertext body is invalid.
>
>
> For a nonempty plaintext that is an exact multiple of `chunk_size`, the final chunk MUST contain `chunk_size` plaintext bytes. No extra empty terminal chunk is emitted or accepted by this profile. For all other nonempty plaintexts, the final chunk contains the remaining 1 through `chunk_size - 1` bytes.
>
> The number of chunks MUST be between 1 and `2^32 - 1`, inclusive. Chunk indices start at zero and end at `chunk_count - 1`; the counter MUST NOT wrap.
>

The upper limit is intentionally one less than the number of values representable by a 32-bit counter. These rules give every plaintext length, including zero, a single final-chunk form.

For plaintext length `P`, ciphertext length `C`, chunk size `S`, and chunk count `N`:

```
Encryption: N = max(1, ceil(P / S))

Decoding:   N = ceil(C / (S + 16))
            last_chunk_length = C - (N - 1) × (S + 16)
            P = C - 16 × N
```

Before decryption, the decoder MUST require `C >= 16`, derive a chunk count within the allowed range, and reject a final ciphertext chunk shorter than 16 bytes. A 16-byte final chunk is valid only when `N = 1`, where it represents empty plaintext. These checks validate the layout; authentication still requires verifying each chunk's tag.

> `chunk_size` MUST be an integer from 4,096 (4 KiB) through 16,777,216 bytes (16 MiB). Implementations MUST support 262,144 bytes (256 KiB). Other sizes within those bounds MAY be supported; unsupported sizes MUST fail explicitly.
>

### Commit to the exact plaintext length when it is known

Chunk count identifies the final chunk but not its original length. For example, shortening a final plaintext chunk from 100 bytes to 68 bytes leaves the derived count unchanged. Authenticating that final chunk detects the change, but a range read over an earlier chunk does not reach it.

Add this optional content parameter to the protected-header table and CDDL:

| Label | Name | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `-65789` | `plaintext_length` | uint | no | chunked scheme only; exact plaintext byte count |

> For the chunked scheme, the protected content header MAY contain `plaintext_length` (label `-65789`). Its value is the exact number of plaintext bytes and may be zero. The parameter MUST NOT appear in the unprotected content header or in scheme 1. Chunk count remains derived from ciphertext length and MUST NOT be stored as this parameter.
>
- `65789` is a private-use label. Use it rather than redefining `65791`, which existing experimental formats use for `chunk_count`. Giving that label a second meaning would make the two formats indistinguishable on the wire.

When `plaintext_length` is present, let `P` be its value and calculate:

```
N = max(1, ceil(P / S))
expected_C = P + 16 × N
```

> If the encoder includes the plaintext_length, it  MUST know `P` before emitting the protected header, derive a count within the allowed range, count the plaintext bytes it consumes, and fail if the consumed total differs from `P`. A streaming encoder MAY emit the header and earlier non-final chunks before discovering a mismatch, but it MUST NOT emit the final chunk after that mismatch is known.
>
>
> The decoder MUST compare `expected_C` with the exact detached ciphertext length for the same object version and reject a mismatch. It MUST still derive the actual chunk layout from the observed ciphertext length and apply the structural checks above. The declared length is unverified until an AEAD tag authenticates the protected header.
>

This exact comparison depends on the single final-chunk form defined above. It also explains why a length is used instead of a stored count: `plaintext_length` determines the count and the exact final-chunk size, while `chunk_count` determines only the final chunk's index. If the input length is unknown before encryption, omit `plaintext_length`; the envelope remains valid without the commitment.

Range decryption requires the envelope boundary and exact ciphertext length for the same object version. A length supplied by an untrusted source is initially unverified. The decoder MUST check every derived offset and size before use, and MUST apply the chunk-range formulas only to nonempty ranges within the derived plaintext bounds. It MUST NOT release a chunk's plaintext before that chunk's authentication tag verifies. An empty range authenticates no content by itself.

> A range read authenticates only the chunks it reads. When `plaintext_length` is present, any authenticated chunk also authenticates the intended total length, so the reader can reject a different observed length without fetching the final chunk. Without that parameter, detecting truncation through `last_flag` requires authenticating the chunk believed to be final. Neither method authenticates unread interior chunks or proves that a remote source possesses unread bytes. Successful whole-object decryption requires authenticating every chunk, including the final one.
>

For example, removing bytes from the final chunk leaves earlier chunks unchanged. Without `plaintext_length`, a range read over an earlier chunk may still authenticate successfully because it never checks the shortened end. With it, the earlier chunk authenticates the committed length, which then disagrees with the shortened ciphertext length reported for that object.

## 5. Define **a small, explicit COSE profile**

Affects **COSE Envelope Structure**, lines 83–144, **Additional Authenticated Data**, lines 194–209, and **Key Management Considerations**, lines 341–359.

COSE supports message forms and options that FEE does not need. FEE uses the following profile so implementations agree on the envelope structure, headers, and authenticated bytes.

### Envelope type

The CBOR tag identifies the COSE structure. It is separate from the AES-GCM authentication tag.

> Use `COSE_Encrypt0` (CBOR tag 16) when the CEK is supplied without a recipient record. Use `COSE_Encrypt` (CBOR tag 96) when one or more recipient records are included. The recipients array MUST be nonempty and MUST NOT contain nested recipient layers.
>
>
> The content ciphertext field inside either COSE structure MUST be `nil`; the detached ciphertext follows the envelope. The content AAD context MUST be `Encrypt0` for tag 16 and `Encrypt` for tag 96. Changing between the two structures changes the AAD and requires new authentication tags.
>

### Header structure and validation

Content protected fields use `bstr .cbor protected_header_map`. Content unprotected fields use `unprotected_header_map`. Recipient protected fields also need the empty-byte-string form required by some algorithms:

```
header_map = { * (int / tstr) => any }
empty_or_serialized_map = bstr .cbor header_map / bstr .size 0

COSE_recipient = [
  protected: empty_or_serialized_map,
  unprotected: header_map,
  ciphertext: bstr,
]
```

The CDDL union permits either recipient form, but the recipient algorithm decides which form is valid. A256KW requires `h''`, which contains no CBOR item and is different from the encoded empty map `h'a0'`. The proposed ECDH-ES+A256KW profile requires an encoded map containing `alg = -31`. Content protected headers cannot be empty because FEE requires `alg`, `typ`, and `iv`.

The content header-map definitions MUST list the FEE fields and permit optional `crit` and extension parameters. They must not be replaced by an unrestricted `header_map`, because the content fields have stricter type and placement rules.

Apply these validation rules:

- Tags 16 and 96 MUST use their matching array structures. The content ciphertext field MUST be `nil`.
- Content protected bytes MUST contain exactly one CBOR map with no trailing data. Recipient protected bytes MUST follow the selected algorithm's empty-or-map rule; an encoded map MUST also contain no trailing data.
- Header parameters MUST have the types, values, and locations required by FEE and by the recipient algorithm. Content-header requirements do not automatically apply to recipient headers.
- The protected `typ` value MUST be `application/vnd.filecoin-encryption+cose`. `chunk_size` MUST be present for scheme 2 and absent for scheme 1. The protected IV MUST have the length required by the selected scheme.
- Encoders MUST NOT produce duplicate map keys, and decoders MUST reject them. A header label appearing in both the protected and unprotected maps at the same layer MUST also be rejected. Compare header labels by their decoded values, not by their encoded bytes.

**COSE crit handling:**

Header maps MAY include extension parameters. Process crit and other standard COSE headers per RFC 9052. If present, crit MUST be protected, and every listed label MUST also be protected, understood, and processed. Otherwise, reject the message.

FEE-required parameters do not need to appear in crit, since FEE readers already process them.

This restates the COSE rule for clarity. It ensures that readers reject messages containing critical extensions they do not understand, rather than silently ignoring them.

### Protected bytes and AAD

Two CBOR encodings can represent the same values with different bytes. Decoding and rebuilding a protected map can therefore break authentication or derive a different recipient key.

> For content authentication, processors MUST use the protected-header byte string received in the envelope without reconstructing or normalizing it. Construct `Enc_structure` as specified in RFC 9052 §§5.3 and 9. When a recipient algorithm uses `COSE_KDF_Context`, construct it according to RFC 9053 §§5.2 and 9 and the rules of that recipient algorithm.
>

### Parser limits

Envelope parsing happens before content authentication, so the decoder must treat the input as untrusted.

> FEE encoders MUST use definite-length arrays, maps, byte strings, and text strings throughout the envelope and serialized protected maps, including nested values. Decoders MUST reject indefinite-length items in those locations. This rule does not interpret the contents of opaque byte strings as CBOR and does not apply to the detached ciphertext.
>

Decoders MUST reject malformed CBOR, duplicate map keys, and values that violate the FEE structure or field types. They MUST NOT reject an otherwise valid envelope only because map keys use a different order. FEE does not require one deterministic encoding of the whole envelope.

Implementations MUST apply resource limits during parsing, before excessive allocation or recursion. They MUST document their limits on envelope size, nesting depth, and collection sizes. The FIP still needs to decide whether these are shared interoperability limits or implementation-specific limits. Whether decoders reject non-minimal integer encodings also remains a separate profile decision.

The rules above do not form a complete ECDH-ES+A256KW profile. Interoperable support for that algorithm still requires choices for curves, public-key encoding and validation, ephemeral keys, salt handling, party information, and the remaining KDF inputs. FEE implementations do not need to support every COSE recipient algorithm. Custom key-management or threshold schemes need their own identifiers and processing rules.

References: [RFC 9052 §§3, 5, and 9](https://www.rfc-editor.org/rfc/rfc9052), [RFC 9053 §§5, 6, and 9](https://www.rfc-editor.org/rfc/rfc9053), and [RFC 8949 §10](https://www.rfc-editor.org/rfc/rfc8949#section-10).

## 6. Clarify what authentication proves

Affects **Protected Headers**, lines 160–182, **Additional Authenticated Data**, lines 207–209, the plaintext-CID description, and **Security Considerations**.

> Envelope metadata is unverified until a relevant AEAD tag succeeds. Before then, fields such as `chunk_size`, `plaintext_length`, content type, and plaintext CID MAY guide bounded parsing and retrieval but MUST NOT be trusted. After authentication, a plaintext CID is still a claim by a CEK holder and MUST be checked against the decrypted plaintext. Content tags do not cover the recipient array, so reordering or removing recipients does not invalidate them. Successful decryption proves knowledge of the CEK, not sender identity or an authenticated access-control policy; those properties require a separate mechanism.
>

In the plaintext-CID table, replace “early validation” with “inspection or filtering before decryption; content verification is a separate step.” Reading metadata without the CEK does not make it trustworthy.

Reference: [RFC 9052 §§5.1, 5.3, 8.3](https://www.rfc-editor.org/rfc/rfc9052).

## 7. Correct the storage-overhead example

Affects [Storage overhead](../.context/filecoin-encryption-envelope-FIP.md#storage-overhead), lines 490–498.

The FIP understates the tag overhead. Each chunk adds a 16-byte authentication tag. At the default chunk size, a 1 GiB file has 4,096 chunks, so tags add 64 KiB, not 4 KiB:

```
1 GiB / 256 KiB = 4,096 chunks
4,096 × 16 bytes = 65,536 bytes = 64 KiB
65,536 / 1,073,741,824 × 100 = 0.006103515625%
```

Replace the chunk-tag row with:

> Chunked scheme per-chunk tags: 16 bytes per chunk; 64 KiB per 1 GiB of plaintext at 256 KiB chunks.
>

Replace the worked-example sentence with:

> For a 1 GiB plaintext with 256 KiB chunks, authentication tags add approximately 0.0061%, plus the encoded envelope size. Envelope size depends on metadata and recipient descriptors; the 60–200-byte estimate is illustrative, not a bound.
>