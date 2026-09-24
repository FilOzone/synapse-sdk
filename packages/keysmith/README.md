# @filoz/keysmith

Deterministic key derivation for encrypted data on Filecoin Onchain Cloud.

One wallet signature per dataset produces every key beneath it. Keysmith stores nothing,
needs no key server, and puts no key material on chain — so a user who still has their
wallet can always read their data, and a user who loses everything else has lost nothing.

Keysmith **sources keys**. It does not encrypt: hand the key it gives you to
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

## The tree

```text
sig = signTypedData(DatasetKey{chainId, service, payer, clientDataSetId, epoch})
DK  = HKDF(r‖s, "foc/acl/dataset/v1")       one dataset
SK  = HKDF(DK,  "foc/acl/scope/v1"‖name)    one section of it
PK  = HKDF(node,"foc/acl/piece/v1"‖salt)    one piece
```

Every edge is one-way: a piece key says nothing about its neighbours, its scope, its
dataset, or the wallet. Datasets share no common ancestor, so no key anywhere opens more
than one of them.

## Writing a piece

```ts
import * as Keysmith from '@filoz/keysmith'

const ref = {
  chainId: 314,
  service: FWSS_ADDRESS,
  payer: account.address,
  clientDataSetId: Keysmith.newClientDataSetId(), // chosen before the dataset exists
}

const secret = await Keysmith.datasetSecret(account, ref) // one wallet prompt
const dk = Keysmith.datasetKey(secret)

const salt = Keysmith.newSalt()
const key = Keysmith.pieceKey(dk, salt)
const metadata = Keysmith.pieceMetadata(ref, { salt }) // goes in the FEE envelope

// Write the commitment into the createDataSet call you were making anyway:
//   metadata: { [Keysmith.COMMITMENT_KEY]: Keysmith.commitment(secret) }
```

`clientDataSetId` is picked by the client and never reused by FWSS for a payer, so the
first piece can be encrypted **before** the dataset exists on chain — no ordering
constraint on the upload pipeline.

## Reading a piece

The envelope carries everything a reader needs, so there is no index to keep in sync:

```ts
const key = Keysmith.keyForEnvelope(dk, metadata) // walks any scope named in the metadata
```

## Sharing

A grant is a node key wrapped to a recipient's secp256k1 public key — their wallet, or a
session key. Nothing is written on chain, and no piece is rewritten:

```ts
const grant = await Keysmith.wrapTo(Keysmith.publicKeyOf(theirKey), dk, {
  v: 1,
  node: 'dataset',
  chainId: ref.chainId,
  service: ref.service,
  payer: ref.payer,
  clientDataSetId: String(ref.clientDataSetId),
})

// recipient, elsewhere:
const dk = await Keysmith.unwrapWith(myPrivateKey, grant)
```

Share a **scope** instead to hand over one section of a dataset:

```ts
const sk = Keysmith.scopeKey(dk, 'invoices')
const grant = await Keysmith.wrapTo(theirPublicKey, sk, { ...descriptor, node: 'scope:invoices' })
```

The recipient reads `invoices` and nothing else, including pieces written after the grant.
The grant's descriptor is authenticated, so it cannot be relabelled as another dataset or
scope.

## Recovery

With the wallet and the chain, and nothing else:

1. List the payer's datasets from FWSS — each carries its `clientDataSetId`.
2. Re-sign `DatasetKey` and compare `Keysmith.commitment(secret)` against the dataset's
   `foc/kc` metadata. A mismatch is a loud error, never a silently wrong key.
3. Derive each piece key from the metadata in its own envelope.

## API

| Function | Purpose |
| --- | --- |
| `datasetSecret(signer, ref)` | One signature per dataset; signs twice and compares |
| `datasetKey(secret)` | The key for a whole dataset |
| `scopeKey(dk, name)` | The key for one section of it |
| `pieceKey(node, salt)` | The key for one piece — hand this to FEE |
| `keyForEnvelope(node, metadata, holding?)` | Derive a piece key from whatever node you hold |
| `pieceMetadata(ref, { salt, scope? })` | What the envelope must record |
| `commitment(secret)` / `COMMITMENT_KEY` | Non-secret check value for FWSS metadata |
| `wrapTo(publicKey, key, descriptor)` | Wrap a node key for a recipient |
| `unwrapWith(privateKey, grant)` | Open a grant |
| `publicKeyOf(privateKey)` | Uncompressed secp256k1 public key |
| `newSalt()` / `newClientDataSetId()` | Fresh public identifiers |

## What to know before you rely on it

- **A signature is a bearer credential.** Anything that can elicit the `DatasetKey`
  signature for a dataset can derive that dataset's keys. Scope is the defence: the
  message names one dataset, so one careless approval costs one dataset, not the wallet's
  whole history. Day-to-day reads never sign, so a prompt is itself an anomaly.
- **Determinism is checked twice**, because the whole scheme rests on it: `datasetSecret`
  signs the same message twice and refuses a signer that disagrees with itself, and the
  `foc/kc` commitment catches a wrong wallet at recovery time.
- **`s` is normalised and `v` is dropped**, so the two malleable forms of a signature
  yield one key.
- **Sharing cannot be undone.** A grant hands over a key; ending future delivery does not
  recall it. To genuinely cut someone off, move that content to a new scope or dataset
  and re-encrypt.
- **A scope name travels in the clear** inside the envelope, because the reader needs it
  to derive. The bytes stay secret; the label does not.
- **Contract accounts and hardware wallets that cannot do ECDH** can hold keys but cannot
  receive grants this way; they need a signature-derived encryption key, which is not in
  this package yet.

## Development

```bash
pnpm --filter @filoz/keysmith build
pnpm --filter @filoz/keysmith test     # node + browser
```
