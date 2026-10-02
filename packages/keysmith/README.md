# @filoz/keysmith

Deterministic key derivation for robust, recoverable, transparent encryption of data on Filecoin Onchain Cloud.

One wallet signature per dataset produces every key beneath it. Keysmith stores nothing,
needs no key server, and puts no key material on chain — so a user who still has their
wallet can always read their data.

Keysmith **generates and derives keys**. It does not encrypt: hand the key it gives you to
[FEE](https://github.com/FilOzone/synapse-sdk/pull/967), which produces the envelope, and
upload that through the Synapse SDK like any other bytes.

```text
your app ──▶ @filoz/keysmith ──key──▶ FEE (envelope) ──bytes──▶ @filoz/synapse-sdk ──▶ FWSS + Curio
```

## Install

```bash
pnpm add @filoz/keysmith
```

Requires `viem` 2.x as a peer dependency. Works in Node.js and browsers; in a browser it
needs a secure context (HTTPS or localhost) for WebCrypto.

## The key derivation tree

Each FWSS dataset has its own primary decryption key, `DK`. From there are derived intermediate keys for protecting identified sections of the dataset, and then from there are derived keys for individual Pieces.

In this way, read and write delegations can be made to other entities over the whole dataset; or a fenced-off section of it; or just a single Piece.

```text
sig = signTypedData(DatasetKey{chainId, service, payer, clientDataSetId, epoch})
DK  = HKDF(r‖s, "foc/acl/dataset/v1")       one dataset
SK  = HKDF(DK,  "foc/acl/scope/v1"‖name)    one section of it
PK  = HKDF(node,"foc/acl/piece/v1"‖salt)    one piece
```

Every derivation is one-way: while sharing a scope key allows access to all Pieces under that scope, a Piece key says nothing about its neighbours, its scope, its
dataset, or the wallet.

## Writing a piece

```ts
import * as Keysmith from '@filoz/keysmith'

const ref = {
  chainId: 314, // mainnet
  service: FWSS_ADDRESS, 
  payer: account.address,
  clientDataSetId: Keysmith.newClientDataSetId(), // or choose your own
}

// One wallet signature. The signature itself stays inside the call; you get
// the dataset key and a public commitment, and have nothing else to guard.
const { dk, commitment } = await Keysmith.datasetKeys(account, ref)

const salt = Keysmith.newSalt()
const key = Keysmith.pieceKey(dk, salt)
const metadata = Keysmith.pieceMetadata(ref, { salt }) // goes in the FEE envelope

// Write the commitment into the createDataSet call you were making anyway:
//   metadata: { [Keysmith.COMMITMENT_KEY]: commitment }
```

The first time a signer is used, `datasetKeys` signs twice and compares, refusing a
signer that does not sign deterministically. That costs one extra wallet prompt, once;
later calls sign once. See `DatasetKeysOptions` to force or skip the check.

## Sharing

A grant is a node key wrapped to a recipient's public key. Nothing is written on chain and
no piece is rewritten: anyone holding `DK` can issue one, offline.

The recipient needs a secp256k1 **private key in hand** to open it — a session key, or
any service or agent holding a local key. A browser wallet will sign for you but will not
hand over its key, so a MetaMask or Ledger user cannot unwrap a grant with this API; that
needs a signature-derived encryption key, which is not in this package yet.

```ts
// Current custodian, sharing out:
const descriptor = Keysmith.grantDescriptor(ref, 'dataset')
const grant = await Keysmith.wrapTo(Keysmith.publicKeyOf(theirKey), dk, descriptor)
```

Send the grant through application channels, eg share link, then:

```ts
// recipient, elsewhere:
const dk = await Keysmith.unwrapWith(myPrivateKey, grant)
```

To share a limited **scope** instead of a whole dataset:

```ts
const sk = Keysmith.scopeKey(dk, 'invoices')
const grant = await Keysmith.wrapTo(theirPublicKey, sk, Keysmith.grantDescriptor(ref, 'scope:invoices'))
```

Build descriptors with `grantDescriptor()` rather than filling the structure by hand. The
descriptor is the grant's authenticated data, compared byte for byte, so it lowercases
addresses and spells the id exactly as the envelope does. Exactly those six fields are
covered: anything else carried alongside a grant is informational and unauthenticated.

The recipient reads `invoices` and nothing else, including pieces written after the grant.
The descriptor is authenticated, so a grant cannot be relabelled as another dataset or
scope.

A grant proves nothing about **who sent it**. Anyone can address one to anyone, with any
key inside; a successful unwrap only shows the descriptor arrived intact. A forged grant
cannot open existing data — the forger does not have `DK` — but a delegate who *writes*
with a key it was handed would be encrypting under a key someone else chose. Before
writing with a key from a grant, open a known piece with it. `publicKeyOf` returns a
key-agreement key derived from the private key, not the signing key itself, so publish
that: one credential, two algorithms, two keys.

ℹ️ NOTE: because shared keys are symmetric and deterministic, sharing the key in this way also enables a suitably permissioned delegate to *write* encrypted data to the dataset as well as read.

## Reading a piece

The FEE envelope carries everything a reader needs, so there is no index to keep in sync.
What you pass depends on which key you were given:

```ts
// the dataset key: walks down into whatever scope the metadata names
const key = Keysmith.keyForEnvelope(dk, metadata)

// a scope key: already at the scope, so don't walk into it again
const key = Keysmith.keyForEnvelope(sk, metadata, 'scope')

// a piece key: nothing to derive — hand it straight to FEE
await decrypt(blob, pk)
```

`DK` and `SK` are both 32 bytes of HKDF output, so nothing in the envelope says which
one you are holding — you have to tell it. The grant that delivered the key holds this information, so keep the whole grant when receiving a share and then use it in the derivation:

```ts
const key = Keysmith.keyForEnvelope(node, metadata, Keysmith.holdingOf(grant))
```

## Recovery

With the wallet, the chain metadata, and the encrypted blobs. Nothing else is required, thus there is nothing the user can lose.

1. List the payer's datasets from FWSS — each carries its `clientDataSetId`.
2. Call `datasetKeys` again and compare its `commitment` against the dataset's `foc/kc`
   metadata, before decrypting anything.
3. Derive each piece key from the metadata in its own envelope.

## Canonical forms

Two things are compared byte for byte — HKDF inputs, and a grant's authenticated fields —
so every value has exactly one spelling, produced by the library rather than the caller:

| Value | Canonical form |
| --- | --- |
| scope name | Unicode NFC; non-empty; no leading or trailing whitespace; case is significant |
| piece salt | lowercase hex |
| `clientDataSetId` | minimal lowercase hex — `0x2a`, never `0x002A` |
| addresses in a grant | lowercase |
| `chainId` and `epoch` in a grant | non-negative integers; a relayed `"314"` is accepted |
| grant `node` | `dataset`, or `scope:` plus a canonical scope name |

`grantDescriptor()` and `pieceMetadata()` emit these forms, and `wrapTo`, `unwrapWith`,
`scopeKey` and `keyForEnvelope` re-canonicalise whatever they are given, so a hand-built
descriptor or a mangling relay cannot split a grant. A grant also names its `epoch`, so
keys for different re-keyings of one dataset are never confused for each other.

## API

| Function | Purpose |
| --- | --- |
| `datasetKeys(signer, ref, options?)` | One signature per dataset → `{ dk, commitment }` |
| `scopeKey(dk, name)` | The key for one section of it |
| `scopeName(name)` | A scope name in canonical form, or a thrown error |
| `pieceKey(node, salt)` | The key for one piece — hand this to FEE |
| `keyForEnvelope(node, metadata, holding?)` | Derive a piece key from whatever node you hold |
| `holdingOf(grant)` | Which level a grant carries, for `keyForEnvelope` |
| `pieceMetadata(ref, { salt, scope? })` | What the envelope must record |
| `COMMITMENT_KEY` | The FWSS metadata key the commitment is written under |
| `grantDescriptor(ref, node)` | Name what a grant unlocks: `'dataset'` or `'scope:<name>'` |
| `wrapTo(publicKey, key, descriptor)` | Wrap a node key for a recipient |
| `unwrapWith(privateKey, grant)` | Open a grant |
| `publicKeyOf(privateKey)` | The key-agreement key to publish, derived from a private key |
| `newSalt()` / `newClientDataSetId()` | Fresh public identifiers |

## Be aware

- **A signature is a bearer credential.** Anything that can elicit the `DatasetKey`
  signature for a dataset can derive that dataset's keys. Scope is the defence: the
  message names one dataset, so one careless approval costs one dataset, not the client's
  whole estate. Day-to-day reads never sign, so a prompt is itself an anomaly.
- **Determinism is checked twice**, because the whole scheme rests on it: on a signer's
  first use `datasetKeys` signs the same message twice and refuses a signer that disagrees
  with itself, and the `foc/kc` commitment catches a wrong wallet at recovery time.
- **Only a plain ECDSA signature is accepted.** A contract account or smart wallet answers
  `signTypedData` with an ABI-encoded blob whose leading bytes are structure, not secret;
  deriving from that would mint a guessable key, so it is refused rather than used.
- **`s` is normalised and `v` is dropped**, so the two malleable forms of a signature
  yield one key.
- **Sharing cannot be undone.** A grant hands over a symmetric key; ending future delivery does not
  recall it. To genuinely cut someone off, move that content to a new scope or dataset
  and re-encrypt.
- **A scope name travels in the clear** inside the envelope, because the reader needs it
  to derive. The bytes stay secret; the label does not.
- **Receiving a grant needs a private key in hand.** Session keys and services can
  unwrap; browser wallets, hardware wallets and contract accounts cannot, because none of
  them expose a key to do ECDH with. They need a signature-derived encryption key, which
  is not in this package yet.
- **Key material cannot be wiped.** JavaScript offers no way to zeroise a `Uint8Array`
  reliably, so treat any process holding `DK` as holding it for its lifetime.

## Development

```bash
pnpm --filter @filoz/keysmith build
pnpm --filter @filoz/keysmith test     # node + browser
```
