# @filoz/keysmith

Deterministic key derivation for robust, recoverable, transparent encryption of data on Filecoin Onchain Cloud.

One wallet signature per keyspace produces every key beneath it. Keysmith stores nothing,
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

## Keyspaces, not datasets

Keys belong to a **keyspace**: a random 16-byte identifier the client mints, which every
envelope carries. It is deliberately independent of FWSS. Replication and repair put copies
of a piece into other datasets, on other providers, sometimes paid for by other accounts —
and because nothing about the dataset is an input to the key, every copy opens with the same
key wherever it lands.

The usual choice is one keyspace per dataset, created alongside it. Nothing enforces that:
several datasets can share a keyspace to save wallet prompts, at the cost of a larger blast
radius for one signature.

## The key derivation tree

Each keyspace has its own key, `KK`. From it are derived **role** keys — access labels such
as `agent-memory` or `super-secret` — and from either of those, keys for individual Pieces.

Roles form a **tree**: a role's key is derived from its parent's, so holding a role opens
that role *and every role beneath it*, and nothing above it or beside it. That is clearance
in the usual sense — `super-secret` contains `super-secret/secret`, which contains
`super-secret/secret/internal`. A role is named by its path from the top.

In this way, read and write delegations can be made to other entities over a whole
keyspace; or everything carrying one role; or just a single Piece.

```text
sig = signTypedData(KeyspaceKey{owner, keyspace, epoch})
KK  = HKDF(r‖s, "foc/acl/keyspace/v1")      the whole keyspace
RK  = HKDF(KK,  "foc/acl/role/v1"‖role)     a top-level role
RK′ = HKDF(RK,  "foc/acl/role/v1"‖child)    a role beneath it, and so on down
PK  = HKDF(node,"foc/acl/piece/v1"‖salt)    one piece
```

Every derivation is one-way: a role key opens every Piece labelled with that role or any role beneath it, but a
Piece key says nothing about its neighbours, its role, its keyspace, or the wallet.

## Writing a piece

```ts
import * as Keysmith from '@filoz/keysmith'

const ref = {
  owner: account.address,
  keyspace: Keysmith.newKeyspace(), // or reuse an existing one
}

// One wallet signature. The signature itself stays inside the call; you get
// the keyspace key and a public commitment, and have nothing else to guard.
const { kk, commitment } = await Keysmith.keyspaceKeys(account, ref)

const salt = Keysmith.newSalt()
const key = Keysmith.pieceKey(Keysmith.roleKey(kk, 'agent-memory'), salt)
const metadata = Keysmith.pieceMetadata(ref, { salt, role: 'agent-memory' }) // goes in the FEE envelope

// Record the keyspace and commitment in the createDataSet call you were making anyway:
//   metadata: { [Keysmith.KEYSPACE_ID_KEY]: ref.keyspace, [Keysmith.COMMITMENT_KEY]: commitment }
```

A piece written without a role is readable only with the keyspace key.

The first time a signer is used, `keyspaceKeys` signs twice and compares, refusing a
signer that does not sign deterministically. That costs one extra wallet prompt, once;
later calls sign once. See `KeyspaceKeysOptions` to force or skip the check.

## Sharing

A grant is a node key wrapped to a recipient's public key. Nothing is written on chain and
no piece is rewritten: anyone holding `KK` can issue one, offline.

The recipient needs a secp256k1 **private key in hand** to open it — a session key, or
any service or agent holding a local key. A browser wallet will sign for you but will not
hand over its key, so a MetaMask or Ledger user cannot unwrap a grant with this API; that
needs a signature-derived encryption key, which is not in this package yet.

```ts
// Current custodian, sharing out the whole keyspace:
const descriptor = Keysmith.grantDescriptor(ref, 'keyspace')
const grant = await Keysmith.wrapTo(Keysmith.publicKeyOf(theirKey), kk, descriptor)
```

Send the grant through application channels, eg share link, then:

```ts
// recipient, elsewhere:
const kk = await Keysmith.unwrapWith(myPrivateKey, grant)
```

To share one **role** instead of the whole keyspace:

```ts
const rk = Keysmith.roleKey(kk, 'agent-memory')
const grant = await Keysmith.wrapTo(theirPublicKey, rk, Keysmith.grantDescriptor(ref, 'role:agent-memory'))
```

The recipient reads everything labelled `agent-memory`, including pieces written after the
grant, and nothing else.

Build descriptors with `grantDescriptor()` rather than filling the structure by hand. The
descriptor is the grant's authenticated data, compared byte for byte, so it is emitted in
canonical form. Exactly its five fields are covered: anything else carried alongside a
grant — a dataset id, a note — is informational and unauthenticated. The descriptor is
authenticated, so a grant cannot be relabelled as another keyspace or role.

A grant proves nothing about **who sent it**. Anyone can address one to anyone, with any
key inside; a successful unwrap only shows the descriptor arrived intact. A forged grant
cannot open existing data — the forger does not have `KK` — but a delegate who *writes*
with a key it was handed would be encrypting under a key someone else chose. Before
writing with a key from a grant, open a known piece with it. `publicKeyOf` returns a
key-agreement key derived from the private key, not the signing key itself, so publish
that: one credential, two algorithms, two keys.

A delegate writing pieces should start from its grant rather than assembling the pieces by
hand. `writeTarget` takes the keyspace and epoch from the grant, checks the role against what
the grant covers, and walks down to the right key:

```ts
const target = Keysmith.writeTarget(grant, key, 'admin/finance/clerks') // throws outside the grant's subtree
const salt = Keysmith.newSalt()
const pieceKey = Keysmith.pieceKey(target.key, salt)
const metadata = Keysmith.pieceMetadata(target.ref, { salt, role: target.role })
```

ℹ️ NOTE: because shared keys are symmetric and deterministic, sharing the key in this way also enables a suitably permissioned delegate to *write* encrypted data under that role as well as read.

## Reading a piece

The FEE envelope carries everything a reader needs, so there is no index to keep in sync,
and it does not matter which dataset or provider the copy came from.
What you pass depends on which key you were given:

```ts
// the keyspace key: walks down into whatever role the metadata names
const key = Keysmith.keyForEnvelope(kk, metadata)

// a role key: say which role it is, and it walks down from there
const key = Keysmith.keyForEnvelope(rk, metadata, { role: 'agent-memory' })

// a piece key: nothing to derive — hand it straight to FEE
await decrypt(blob, pk)
```

`KK` and `RK` are both 32 bytes of HKDF output, so nothing in the envelope says which
one you are holding — you have to tell it. The grant that delivered the key holds this information, so keep the whole grant when receiving a share and then use it in the derivation:

```ts
const key = Keysmith.keyForEnvelope(node, metadata, Keysmith.holdingOf(grant))
```

## Recovery

With the wallet and the encrypted blobs. Nothing else is required, thus there is nothing the user can lose.

1. Read `foc/ks` from each envelope — or, to find datasets before fetching pieces, from
   each dataset's `KEYSPACE_ID_KEY` metadata.
2. Call `keyspaceKeys` once per distinct keyspace. Where a dataset recorded a commitment,
   compare it before decrypting anything.
3. Derive each piece key from the metadata in its own envelope.

A copy found in a dataset other than the one it was written to opens exactly the same way:
the envelope, not the dataset, names its keyspace. Because the commitment is derived from
`KK`, anything holding the keyspace key — an agent replicating data, say — can record it in
a new dataset's metadata too.

## Canonical forms

Two things are compared byte for byte — HKDF inputs, and a grant's authenticated fields —
so every value has exactly one spelling, produced by the library rather than the caller:

| Value | Canonical form |
| --- | --- |
| keyspace id | exactly 16 bytes, lowercase hex; leading zeros kept |
| role path | names joined by `/`, top first; each name Unicode NFC, non-empty, unpadded, no `/`; case is significant |
| piece salt | lowercase hex |
| owner in a grant | lowercase |
| `epoch` in a grant | non-negative integer; a relayed `"0"` is accepted |
| grant `node` | `keyspace`, or `role:` plus a canonical role path |

`grantDescriptor()` and `pieceMetadata()` emit these forms, and `wrapTo`, `unwrapWith`,
`roleKey` and `keyForEnvelope` re-canonicalise whatever they are given, so a hand-built
descriptor or a mangling relay cannot split a grant. A grant also names its `epoch`, so
keys for different re-keyings of one keyspace are never confused for each other.

## API

| Function | Purpose |
| --- | --- |
| `newKeyspace()` | A fresh keyspace id |
| `keyspaceKeys(signer, ref, options?)` | One signature per keyspace → `{ kk, commitment }` |
| `roleKey(kk, path)` | The key for a role, e.g. `'super-secret/secret'` |
| `roleName(name)` / `rolePath(path)` | A role name or path in canonical form, or a thrown error |
| `pieceKey(node, salt)` | The key for one piece — hand this to FEE |
| `keyForEnvelope(node, metadata, holding?)` | Derive a piece key from whatever node you hold |
| `writeTarget(grant, key, role?)` | For a delegate: the ref, role and key to write a piece, refusing roles its grant does not cover |
| `holdingOf(grant)` | Which level a grant carries, for `keyForEnvelope` |
| `pieceMetadata(ref, { salt, role? })` | What the envelope must record |
| `commitment(kk)` | The non-secret check value, recomputable by any `KK` holder |
| `KEYSPACE_ID_KEY` / `COMMITMENT_KEY` | FWSS metadata keys for the keyspace id and commitment |
| `grantDescriptor(ref, node)` | Name what a grant unlocks: `'keyspace'` or `'role:<name>'` |
| `wrapTo(publicKey, key, descriptor)` | Wrap a node key for a recipient |
| `unwrapWith(privateKey, grant)` | Open a grant |
| `publicKeyOf(privateKey)` | The key-agreement key to publish, derived from a private key |
| `newSalt()` | A fresh per-piece salt |

## Be aware

- **A signature is a bearer credential.** Anything that can elicit the `KeyspaceKey`
  signature for a keyspace can derive that keyspace's keys. Scope is the defence: the
  message names one keyspace, so one careless approval costs one keyspace, not the client's
  whole estate. Day-to-day reads never sign, so a prompt is itself an anomaly.
- **Determinism is checked twice**, because the whole scheme rests on it: on a signer's
  first use `keyspaceKeys` signs the same message twice and refuses a signer that disagrees
  with itself, and the `foc/kc` commitment catches a wrong wallet at recovery time.
- **Only a plain ECDSA signature is accepted.** A contract account or smart wallet answers
  `signTypedData` with an ABI-encoded blob whose leading bytes are structure, not secret;
  deriving from that would mint a guessable key, so it is refused rather than used.
- **`s` is normalised and `v` is dropped**, so the two malleable forms of a signature
  yield one key.
- **Roles form a tree, not a graph.** Each role has exactly one parent, so a role cannot
  inherit from two (`finance-lead` over both `finance` and `audit`), and each piece carries
  one role. Both need keys wrapped per parent rather than derived — and somewhere to keep
  those wraps — which is not in this package yet.
- **A role's position is part of its key.** Moving or renaming a role re-keys everything
  beneath it, so settle the shape of the tree before writing data under it.
- **Role names travel in the clear** inside the envelope, because the reader needs them to
  derive. For access labels that is a leak of *classification* — an observer learns which
  pieces are `super-secret`, and with a tree, the shape of the hierarchy too. Prefer opaque role ids, and keep display names in your app.
- **Sharing cannot be undone.** A grant hands over a symmetric key; ending future delivery does not
  recall it. To genuinely cut someone off, move that content to a new role or keyspace
  and re-encrypt.
- **Receiving a grant needs a private key in hand.** Session keys and services can
  unwrap; browser wallets, hardware wallets and contract accounts cannot, because none of
  them expose a key to do ECDH with. They need a signature-derived encryption key, which
  is not in this package yet.
- **Key material cannot be wiped.** JavaScript offers no way to zeroise a `Uint8Array`
  reliably, so treat any process holding `KK` as holding it for its lifetime.

## Development

```bash
pnpm --filter @filoz/keysmith build
pnpm --filter @filoz/keysmith test     # node + browser
```
