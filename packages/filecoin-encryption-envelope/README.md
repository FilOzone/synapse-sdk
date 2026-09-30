# Filecoin Encryption Envelope

Filecoin Encryption Envelope (FEE) is a proposed format for portable encrypted
data, described in [FIP #1253](https://github.com/filecoin-project/FIPs/discussions/1253).
An encoded FEE object starts with a COSE (CBOR) envelope containing the
algorithm, nonce information, and optional recipient records, followed by the
detached ciphertext. Separating that metadata from the ciphertext is meant to
help different applications and key-management systems work with the same
encrypted data stored on Filecoin.

This package implements a draft FEE profile. It supports chunked AES-256-GCM
encryption, authenticated range reads, and one-shot AES-GCM for small objects.
It uses Web Crypto and Web Streams in Node.js and browsers.

The root `encrypt()` and `decrypt()` functions use the chunked scheme (scheme 2).
Use them for files and for objects you may need to read by range. The separate
`aesGcm` functions use whole-object encryption (scheme 1) and accept at most
64 MiB of plaintext. The library does not switch between schemes automatically.

## Encrypt and decrypt a stream

The application supplies a 32-byte content-encryption key (CEK). Generate a
fresh, secret CEK for each new encryption unless your key-management system
defines a different reuse policy. The library generates the encryption nonce.

```ts
import * as fee from '@filoz/filecoin-encryption-envelope'

const cek = crypto.getRandomValues(new Uint8Array(fee.constants.KEY_SIZE))

// plaintextSource and encryptedSource are ReadableStream<Uint8Array> values.
// encryptedSink and plaintextSink are WritableStream<Uint8Array> values.
await plaintextSource.pipeThrough(fee.encrypt({ cek })).pipeTo(encryptedSink)
await encryptedSource.pipeThrough(fee.decrypt(cek)).pipeTo(plaintextSink)
```

Decryption releases each plaintext chunk only after its tag verifies. The
final chunk is written when the encryption input closes, so a source that
never closes cannot produce a complete object.

If the exact plaintext length is known, pass `contentLength`. The library
commits to that length in the protected header and fails the stream if the
source supplies a different number of bytes. Omit it when the length cannot
be guaranteed.

For a browser `File` and a file handle supplied by the application:

```ts
async function saveEncryptedFile(file: File, handle: FileSystemFileHandle, cek: Uint8Array) {
  const destination = await handle.createWritable()
  await file.stream()
    .pipeThrough(fee.encrypt({ cek, contentLength: file.size }))
    .pipeTo(destination)
}
```

If a stream errors, discard all output already written or read. A storage sink
that keeps a partial upload must remove it; earlier chunks are not a complete
encrypted object.

For a small object already held in memory, scheme 1 is a one-shot alternative:

```ts
const cek = crypto.getRandomValues(new Uint8Array(fee.constants.KEY_SIZE))
const encoded = await fee.aesGcm.encrypt(plaintext, { cek })
const restored = await fee.aesGcm.decrypt(encoded, cek)
```

## Recipients

A recipient record wraps the CEK so another holder of a key-encryption key
(KEK) can recover it. The built-in recipient algorithm is A256KW: both sides
must already have the same secret 32-byte KEK. A `kid` identifies which KEK to
try; it is not itself a secret.

```ts
const cek = crypto.getRandomValues(new Uint8Array(fee.constants.KEY_SIZE))
const kid = new TextEncoder().encode('recipient-1')
// kek is a secret 32-byte key supplied by your key-management system.

await plaintextSource
  .pipeThrough(fee.encrypt({
    cek,
    recipients: [{ alg: fee.constants.ALG_A256KW, kek, kid }],
  }))
  .pipeTo(encryptedSink)

const unwrapper = await fee.recipients.createA256KWUnwrapper([{ kek, kid }])
await encryptedSource.pipeThrough(fee.decryptWith(unwrapper)).pipeTo(plaintextSink)
```

The same CEK encrypts the content once; recipient records contain wrapped
copies of that CEK. A caller that already has the CEK can use `decrypt(cek)`
without unwrapping a recipient.

## Read a byte range

Range reads work only with the chunked scheme. A `RandomAccessSource` reports
the **exact encoded-object size**, including the envelope, and opens byte
ranges from one immutable object version. An HTTP adapter can use an immutable
URL or enforce an object version with conditional requests. The size and every
range response must refer to that same version.

This adapter assumes `versionedUrl` identifies an immutable object and `size`
is its exact encoded length. The library checks that the returned stream has
exactly the requested number of bytes; the adapter also checks the HTTP range
response before handing it over.

```ts
function httpSource(versionedUrl: string, size: number): fee.RandomAccessSource {
  return {
    size,
    async openRange(offset, length) {
      const end = offset + length - 1
      const response = await fetch(versionedUrl, {
        headers: { Range: `bytes=${offset}-${end}` },
      })
      if (
        response.status !== 206 ||
        response.headers.get('Content-Range') !== `bytes ${offset}-${end}/${size}` ||
        !response.body
      ) {
        await response.body?.cancel()
        throw new Error('Unexpected HTTP range response')
      }
      return response.body
    },
  }
}

const source = httpSource(versionedUrl, exactEncodedLength)
const info = await fee.parse(source)
if (info.scheme !== 'chunked') throw new Error('Range reads require a chunked object')

const result = await fee.decryptRange(
  source,
  cek,
  { offset: 100_000, length: 50_000 },
  { params: info.params }
)
await result.stream.pipeTo(rangeSink)
```

`parse()` reads the envelope without a key and returns parameters that let the
range read skip a second envelope fetch. Its output is **not authenticated**.
Use the returned `params` only with the same object version. A range read
authenticates the chunks it fetches, not unread chunks elsewhere in the object.

## Resolve a key from envelope metadata

A streaming reader can ask your application to derive or fetch the CEK after
it sees the envelope. The resolver receives unauthenticated metadata, so
validate any scope or identifier before using it for a key lookup.

```ts
// allowedScope and keyStore are supplied by your application.
const resolver: fee.KeyResolver = async (info) => {
  const scope = info.appMetadata?.scope
  const salt = info.appMetadata?.salt
  if (scope !== allowedScope || typeof salt !== 'string' || !/^[0-9a-f]{32}$/.test(salt)) {
    throw new Error('Envelope metadata is not allowed for this key lookup')
  }
  // keyStore is your application or key-management library.
  return keyStore.deriveCek({ scope, salt })
}

await encryptedSource.pipeThrough(fee.decrypt(resolver)).pipeTo(plaintextSink)
```

The resolver runs once, before any chunk is decrypted. Its checks control
which key may be requested; they do not authenticate the metadata. For a range
read, call `parse(source)`, validate its metadata, derive the CEK, then pass
that key and `info.params` to `decryptRange()`.

## Security and limits

- CEKs and A256KW KEKs must be 32-byte `Uint8Array` values and cannot be all
  zero. The library validates their shape but cannot tell whether they are
  secret, unpredictable, or fresh.
- Streaming options, including keys and metadata, are borrowed until the stream
  closes or errors. Do not modify or clear them while it is running. A plaintext
  block may be reused once its `write()` resolves.
- Application metadata is visible without a key. Its values are authenticated
  only after a content tag verifies. Content tags do not authenticate the
  recipient list or establish sender identity.
- A failed stream may already have emitted bytes. Discard them all. Successful
  decryption of an entire object requires reading through the final chunk.

The chunked scheme permits an encoded object of at most 64 GiB. Scheme 1
permits at most 64 MiB of plaintext. For the wire profile, range rules, and
other limits, see the [implementation guide](docs/implementation-guide.md).
