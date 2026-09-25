# @filoz/keysmith

Deterministic key derivation for robust, recoverable, transparent  encryption of data on Filecoin Onchain Cloud.

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

Requires `viem` 2.x as a peer dependency. Works in Node.js and browsers.

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

const secret = await Keysmith.datasetSecret(account, ref) // requires payer wallet signature
const dk = Keysmith.datasetKey(secret)

const salt = Keysmith.newSalt()
const key = Keysmith.pieceKey(dk, salt)
const metadata = Keysmith.pieceMetadata(ref, { salt }) // goes in the FEE envelope

// Write the commitment into the createDataSet call you were making anyway:
//   metadata: { [Keysmith.COMMITMENT_KEY]: Keysmith.commitment(secret) }
```

## Sharing

A grant is a node key wrapped to a recipient's secp256k1 public key — their wallet, or a
session key. Nothing is written on chain, and no piece is rewritten, so as long as the caller has their own copy of DK this can be done completely offline with no auth:

```ts
// Current custodian, sharing out:
const grant = await Keysmith.wrapTo(Keysmith.publicKeyOf(theirKey), dk, {
  v: 1,
  node: 'dataset',
  chainId: ref.chainId,
  service: ref.service,
  payer: ref.payer,
  clientDataSetId: String(ref.clientDataSetId),
})
```
Send the grant through application channels, eg share link, then:
```ts
// recipient, elsewhere:
const dk = await Keysmith.unwrapWith(myPrivateKey, grant)
```

To share a limited **scope** instead of a whole dataset:

```ts
const sk = Keysmith.scopeKey(dk, 'invoices')
const grant = await Keysmith.wrapTo(theirPublicKey, sk, { ...descriptor, node: 'scope:invoices' })
```

The recipient reads `invoices` and nothing else, including pieces written after the grant.
The grant's descriptor is authenticated, so it cannot be relabelled as another dataset or
scope.

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

With the wallet, the chain metadata, and the encrypted bkobs. Nothing else is required, thus there is nothing the user can lose.

1. List the payer's datasets from FWSS — each carries its `clientDataSetId`.
2. Re-sign `DatasetKey` and compare `Keysmith.commitment(secret)` against the dataset's
   `foc/kc` metadata.
3. Derive each piece key from the metadata in its own envelope.

## API

| Function | Purpose |
| --- | --- |
| `datasetSecret(signer, ref)` | One signature per dataset; signs twice and compares |
| `datasetKey(secret)` | The key for a whole dataset |
| `scopeKey(dk, name)` | The key for one section of it |
| `pieceKey(node, salt)` | The key for one piece — hand this to FEE |
| `keyForEnvelope(node, metadata, holding?)` | Derive a piece key from whatever node you hold |
| `holdingOf(grant)` | Which level a grant carries, for `keyForEnvelope` |
| `pieceMetadata(ref, { salt, scope? })` | What the envelope must record |
| `commitment(secret)` / `COMMITMENT_KEY` | Non-secret check value for FWSS metadata |
| `wrapTo(publicKey, key, descriptor)` | Wrap a node key for a recipient |
| `unwrapWith(privateKey, grant)` | Open a grant |
| `publicKeyOf(privateKey)` | Uncompressed secp256k1 public key |
| `newSalt()` / `newClientDataSetId()` | Fresh public identifiers |

## Be aware

- **A signature is a bearer credential.** Anything that can elicit the `DatasetKey`
  signature for a dataset can derive that dataset's keys. Scope is the defence: the
  message names one dataset, so one careless approval costs one dataset, not the client's
  whole estate. Day-to-day reads never sign, so a prompt is itself an anomaly.
- **Determinism is checked twice**, because the whole scheme rests on it: `datasetSecret`
  signs the same message twice and refuses a signer that disagrees with itself, and the
  `foc/kc` commitment catches a wrong wallet at recovery time.
- **`s` is normalised and `v` is dropped**, so the two malleable forms of a signature
  yield one key.
- **Sharing cannot be undone.** A grant hands over a symmetric key; ending future delivery does not
  recall it. To genuinely cut someone off, move that content to a new scope or dataset
  and re-encrypt.
- **A scope name travels in the clear** inside the envelope, because the reader needs it
  to derive. The bytes stay secret; the label does not.
- **Contract accounts and hardware wallets that cannot do ECDH** can hold keys but cannot
  receive grants this way; they need a signature-derived encryption key, which is not supported in
  this package.

## Development

```bash
pnpm --filter @filoz/keysmith build
pnpm --filter @filoz/keysmith test     # node + browser
```
