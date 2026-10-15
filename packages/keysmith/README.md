# @filoz/keysmith

Deterministic key derivation for robust, recoverable encryption of data on
Filecoin Onchain Cloud.

Private data on Filecoin uses the Filecoin Encryption Envelope (FEE), such 
that the data stored as pieces with an SP consist of the plaintext envelope 
followed by encrypted bytes. 

Keysmith provides a mechanism for generating piece encryption keys in a
derivation tree rooted from the dataset owner's wallet, enabling fine-grained
sharing of sections of a payer’s datasets without introducing a key storage
problem: if you ever forget a key, you can always get it back for the price
of 1 wallet operation.

Keysmith **generates and derives keys**. It does not encrypt: hand the key
it gives you to the FEE implementation along with your envelope metadata,
and upload that through the Synapse SDK like any other bytes.

```text
your app ──▶ @filoz/keysmith ──key──▶ FEE (envelope) ──bytes──▶ @filoz/synapse-sdk ──▶ FWSS + Curio
```

## Install

```bash
pnpm add @filoz/keysmith
```

Requires `viem` 2.x as a peer dependency. Works in Node.js and browsers; in a browser it
needs a secure context (HTTPS or localhost) for WebCrypto.

## Development

```bash
pnpm --filter @filoz/keysmith build
pnpm --filter @filoz/keysmith test     # node + browser
```

`test/vectors.json` pins the outputs for fixed inputs (the well-known Anvil development
keys). If a change alters any of them, existing keys would be orphaned. Other
implementations can test themselves against the same file.

## Core concepts

- **Keyspace** is the top level concept: the keyspace key forms the root of the
tree. The keyspace key binds back to the payer wallet (we assume that the payer
can *always* access *everything* they are maintaining). Anyone holding the
keyspace key can ultimately decrypt any Piece underneath it.
- **Scopes** are intermediate nodes on the tree: just like scopes in other
security protocols they are highly flexible and user/application-defined, and
can model metaphors like ‘subfolders’, or ‘roles’, ‘security classification’.
Any of these metaphors (and more!) work, but it would be very dangerous to try
to mix them! Anyone with the scope key can **read and write** pieces below that
scope in the tree, but cannot go up or sideways, allowing apps/users to limit
access to different session keys/apps.
- **Pieces** are all encrypted with a unique key (still deterministically
derived from their keyspace/scope), enabling sharing of individual pieces
of data with others on a safe, ad-hoc basis.

**There is no subdivision below the Piece level**.

**One wallet signature per keyspace derives every key beneath it**, nothing is
stored (except for convenience, eg caching of grants for agent sessions), and
the wallet alone is sufficient to recover all the Piece encryption keys in a
payer’s datsets (eg in the event that they lose their cached pieces or session
key or something). 

**Keys are shared by wrapping an encryption key** (any layer of the hierarchy)
under the recipient’s public key (eg a Session Key Registry key) into a
structured grant object: about 190 bytes of CBOR.

**Each piece’s FEE envelope contains sufficient metadata to identify which
key is needed to decrypt it**, so even if the Piece migrates out of its original
FWSS dataset or was written prior to a key rollover it can be reopened by
suitably authorized actors.

## Keyspaces

Keys belong to a **keyspace**: a random 16-byte identifier the client chooses,
which every envelope carries. It is deliberately independent of FWSS datasets:
replication and repair can put copies of a piece into other datasets, on other
providers, sometimes paid for by other accounts — so tying to FWSS-chosen
identities could lead to issues with recovering keys later. With user-selected
keyspaces every copy of a Piece opens with the same key wherever it is fetched
from.

The default choice is one keyspace per dataset, and synapse stores the keyspace
id in the dataset metadata so that applications don't need to remember it.
Applications can override this behavior if they have good reason to, but must
then make sure to keep track of keyspaces and know which to use at any given
time.

To re-key, or maintain a hard separation between different sections of data,
simply make a new keyspace: its keys are then unrelated to the old ones.
(in which case it's stored in the dataset metadata and you can read it back
from the chain).

**IMPORTANT**: Initializing a keyspace requires the payer wallet to sign a
specially-crafted message, one time, and thereafter as long as they remember
the Keyspace Key (KK) all further operations can be performed in code with
Session Keys or other EOAs. Because this scheme demands deterministic
signatures the signing must happen in a wallet or library tha supports RFC
6979 - keysmith includes a check for this before returning a root KK.

## The key derivation tree

Each keyspace has its own root key, `KK`. From it are derived **scope** keys 
— access labels such as `agent-memory` or `super-secret` — and from either of
those, keys for individual Pieces.

A scope is a user/application-chosen access label (string) such as
`agent-memory` or `super-secret`. Scopes are the intermediate nodes of the
derivation tree, between the all powerful root and single Pieces and allow 
elegation of portions of the entire keyspace to non-owner actors, processes,
agents or whatever.

Keysmith is unopinionated about how scopes are used, or what’s in them, other
than the `/` separator. The `/` allows specification of sub-scopes and finer
divisions. Because we’re dealing with strings and need deterministic encoding
each segment is Unicode NFC, non-empty, unpadded and without `/`; case is
significant. Keysmith refuses a non-canonical name rather than silently
normalising it and generating mismatched keys.

A scope key is derived from its parent’s key, so **holding a scope means you can
access all data and sub-scopes beneath it, but nothing above or beside it**.
Examples:

- Clearance levels/MLS: `top-secret` contains `top-secret/secret`, which contains
`top-secret/secret/official`. A holder of `top-secret/secret` can grant an agent
access to `top-secret/secret/official` and they can happily operate in that
`official` layer without being able to walk back up the tree.
- Naive RBAC: `super-admin` contains `super-admin/admin`, which contains 
`super-admin/admin/user`. A holder of `super-admin` can grant a session key access
to `super-admin/admin` and they can happily manage `users`without being able to
walk back up the tree.

This may look counter-intuitive, starting at most privileged and walking outward,
or specifying the whole `top-secret/secret/official` rather than just `official`,
but the way the crypto and grants work saves the entire path to look at and verify
where the grant came from (all the way back to the root) but the actual node key
shared is only the last element of the path. So you can verify up, but only derive
and decrypt down.

## Metadata handling

Keysmith requires no additional key storage: encryption grants can be handled
in whatever way the application currently handles its session keys. It does
however maintain key recovery metadata in two places:

| Where | Keys | Written | Needed to decrypt? |
| --- | --- | --- | --- |
| FEE envelope (`pieceMetadata`) | `foc/v`, `foc/own`, `foc/ks`, `foc/scope`, `foc/salt` | per piece | **yes** — this is what `keyForEnvelope` reads, and the source of truth |
| FWSS dataset metadata | `foc/ks`, `foc/kc` | once, at `createDataSet` | no — lets a client list its keyspaces from the chain, and check its key before decrypting |

- **No key material lives on chain.** The keyspace id is public by design; the commitment is a one-way function of a key that is never published.
- **Every piece names its owner.** `foc/own` lets a provider serve the piece only to a grant chain rooted at that owner. For verification only: not used in key derivation.
- **All you need when you need it:**
    - When **reading**, the envelope metadata is enough for the caller to know which of
    their derived/granted keys they need to decrypt.
    - When **writing**, the dataset metadata is enough for the caller to derive the
    right encryption key for their new Piece.
- **Scope names travel in the clear.** The reader needs them to derive, so an observer
learns which pieces are `super-secret`, and with a tree, the shape of the hierarchy.
If that matters to you, use opaque scope ids and map them at the application layer.

The dataset entries also help a writer that has no envelope to draw from yet: it can learn
a dataset's keyspace before adding to it. Like all FWSS metadata they are public, so the
keyspace id goes on chain; no key does.

## Initializing a keyspace

Starting a keyspace and rooting it in the wallet requires 2 wallet signatures
(one to generate the key and the second to verify determinism). 

To initialize and write an initial piece to a new dataset:

```ts
import * as Keysmith from '@filoz/keysmith'

const ref = {
  owner: account.address,
  keyspace: Keysmith.newKeyspace(), // or reuse an existing one
}

// For a new keyspace the wallet signs twice, so Keysmith can check it signs
// deterministically. The signature itself stays inside the call; you get the
// keyspace key, a public commitment, and a descriptor of exactly what was signed.
const { kk, commitment, descriptor } = await Keysmith.keyspaceKeys(account, ref)

// Write the way a delegate does: the keyspace comes from what was signed,
// so a stale key or a mistyped ref cannot produce an envelope nobody can open.
const target = Keysmith.writeTarget(descriptor, kk, 'agent-memory')
const salt = Keysmith.newSalt()
const key = Keysmith.pieceKey(target.key, salt) // hand to FEE
const metadata = Keysmith.pieceMetadata(target.ref, { salt, scope: target.scope }) // goes in the FEE envelope

// Record the keyspace and commitment in the createDataSet call you were making anyway:
//   metadata: { [Keysmith.KEYSPACE_ID_KEY]: ref.keyspace, [Keysmith.COMMITMENT_KEY]: commitment }
```

## Sharing

Collaboration in a dataset requires multiple actors to have access to the same
set of encryption keys. These keys are shared through *grants*, consisting of
essential metadata and a node key wrapped to a recipient's public key.
Nothing is written on chain: the application is responsible for distributing
the grant once it is made.

The recipient needs a secp256k1 **private key in hand** to open it — a session
key, or any service or agent holding a local key.

ℹ️ NOTE: Build grants with `grantDescriptor()` rather than filling the structure
by hand. The descriptor is the grant's authenticated data, compared byte for byte,
so it must be constructed with its precise canonical form.

ℹ️ NOTE: Because shared keys are symmetric and deterministic, sharing the key in
this way also enables a suitably permissioned delegate to *write* encrypted data
under that scope as well as read. However, write access (`addPieces`) is separately
access controlled in FWSS, so keep session keys and scopes for reading and writing
tightly in sync. The default FWSS implementation does this for you, but if you
choose to go another path, watch out for this.

### Grants on the wire

`wrapTo` returns the grant as an object; `encodeGrant` turns it into bytes to send
or store, and `decodeGrant` reads them back. `unwrapWith` takes either.

```text
grant = {                 ; a CBOR map
  0 => 1,                 ; v: version 1 implies ECDH-ES + A256GCM over secp256k1
  1 => tstr,              ; node: "keyspace" / "scope:<path>" / "piece:<salt>"
  2 => bstr .size 20,     ; owner
  3 => bstr .size 16,     ; keyspace
  4 => bstr .size 65,     ; epk, the ephemeral public key, uncompressed
  5 => bstr .size 12,     ; iv
  6 => bstr .size 48,     ; ct: the wrapped node key and its tag
  * tstr => any,          ; informational, e.g. "pieceCid": not authenticated
}
```

The authenticated data is `[v, node, owner, keyspace]` as deterministic CBOR
(RFC 8949 §4.2.1), with the owner and keyspace as bytes, so every implementation
builds the same bytes. `decodeGrant` accepts only canonical CBOR: no indefinite
lengths, duplicate keys, tags, trailing bytes or unknown numbered fields. 

When sending a grant to a recipient over a text channel, use a safe
deterministic encoding such as Base64.

### Sharing the entire keyspace

```ts
// Current custodian, sharing out the whole keyspace:
const descriptor = Keysmith.grantDescriptor(ref, 'keyspace')
const grant = await Keysmith.wrapTo(Keysmith.publicKeyOf(theirKey), kk, descriptor)
const bytes = Keysmith.encodeGrant(grant)
```

Send the bytes through application channels, eg share link, then:

```ts
// recipient, elsewhere:
const kk = await Keysmith.unwrapWith(myPrivateKey, bytes)
```

The recipient is all-powerful: with KK they can read, write, and onwardly
delegate access to any data in the keyspace.

### Sharing a scope

Sharing scopes is the most common option: it allows the reading and writing of pieces to a restricted logical partition of your dataset, ensuring frictionless operation of processes without compromising your entire estate.

To share one **scope** instead of the whole keyspace:

```ts
const rk = Keysmith.scopeKey(kk, 'agent-memory')
const grant = await Keysmith.wrapTo(theirPublicKey, rk, Keysmith.grantDescriptor(ref, 'scope:agent-memory'))
```

The recipient can then:
 * read everything in `agent-memory` scope: all past and future pieces.
 * write new pieces to the `agent-memory` scope
 * access, create and delegate sub-scopes (eg `agent-memory/conversations/1234`)

## Sharing a single piece

To share one **piece**, wrap its piece key. The grant names the piece by its salt,
and the piece's CID rides alongside so the recipient knows what to fetch:

```ts
// anyone holding a node above the piece:
const pk = Keysmith.keyForEnvelope(kk, metadata)
const bytes = Keysmith.encodeGrant({
  ...(await Keysmith.wrapTo(theirPublicKey, pk, Keysmith.grantDescriptor(ref, Keysmith.pieceNode(metadata)))),
  pieceCid, // where to fetch it: informational, outside the authenticated descriptor
})

// recipient:
const grant = Keysmith.decodeGrant(bytes)
// fetch grant.pieceCid, read the metadata from its envelope, then
const node = await Keysmith.unwrapWith(myPrivateKey, grant)
const key = Keysmith.keyForEnvelope(node, metadata, Keysmith.holdingOf(grant))
```

The grant is bound to the salt rather than the CID: the salt is what the key is derived
from, it has one canonical spelling (a piece has several CID spellings), it is known before
upload, and `keyForEnvelope` checks it against the envelope at no cost. The CID needs no
protection: if it is wrong, the recipient fetches a piece with a different salt, and
`keyForEnvelope` refuses it. The recipient reads that one piece and nothing else. A piece grant is read-only, and `writeTarget` refuses it: FEE needs
a fresh key for every object, so a piece key must never encrypt anything else.

A delegate writing pieces should start from its grant rather than assembling the pieces by
hand. `writeTarget` takes the keyspace from the grant, checks the scope against what
the grant covers, and walks down to the right key:

## Reading a piece

```ts
const target = Keysmith.writeTarget(grant, key, 'admin/finance/clerks')
const salt = Keysmith.newSalt()
const pieceKey = Keysmith.pieceKey(target.key, salt)
const metadata = Keysmith.pieceMetadata(target.ref, { salt, scope: target.scope })
```

ℹ️ NOTE: A piece written without a scope is readable only with the keyspace key,
or by directly sharing its piece key.

## Reading a piece

The FEE envelope carries everything a reader needs, so there is no index to
keep in sync, and it does not matter which dataset or provider the copy came
from.

What you pass depends on which key you were given:

```ts
// the keyspace key: walks down into whatever scope the metadata names
const key = Keysmith.keyForEnvelope(kk, metadata)

// a scope key: say which scope it is, and it walks down from there
const key = Keysmith.keyForEnvelope(rk, metadata, { scope: 'agent-memory' })

// a piece key: nothing to derive — hand it straight to FEE
await decrypt(blob, pk)
```

`KK`, `RK` and a piece key are all 32 bytes of HKDF output, so nothing in the
envelope says which one you are holding — you have to tell it. The grant that
delivered the key holds this information, so keep the whole grant when
receiving a share and then use it in the derivation:

```ts
const key = Keysmith.keyForEnvelope(node, metadata, Keysmith.holdingOf(grant))
```

## Recovery

With the wallet and the encrypted blobs. Nothing else is required, thus there is nothing the user can lose.

1. List the wallet's datasets, and fetch their pieces. A dataset's `KEYSPACE_ID_KEY`
   metadata says which keyspace to expect, but **each envelope is the source of truth**:
   read `foc/ks` from it.
2. Call `keyspaceKeys` once per distinct keyspace, passing the commitment the dataset
   recorded. It signs once, and throws before anything is decrypted if the key does not
   match:

   ```ts
   const { kk } = await Keysmith.keyspaceKeys(
     wallet,
     { owner, keyspace: datasetMetadata[Keysmith.KEYSPACE_ID_KEY] },
     { commitment: datasetMetadata[Keysmith.COMMITMENT_KEY] } // wrong wallet, or a signer that is not deterministic, throws
   )
   ```

   Where a dataset recorded no commitment, leave it out: `keyspaceKeys` signs twice
   instead, and a wrong key shows up only as FEE decryption failing.
3. Derive each piece key from the metadata in its own envelope.

A copy found in a dataset other than the one it was written to opens exactly the same way:
the envelope, not the dataset, names its keyspace. Because the commitment is derived from
`KK`, anything holding the keyspace key — an agent replicating data, say — can record it in
a new dataset's metadata too.

## API

| Function | Purpose |
| --- | --- |
| `newKeyspace()` | A fresh keyspace id |
| `keyspaceKeys(signer, ref, { commitment?, verifySigner? })` | One owner signature per keyspace (two without a recorded commitment) → `{ kk, commitment, descriptor }` |
| `scopeKey(kk, path)` | The key for a scope, e.g. `'super-secret/secret'` |
| `scopeName(name)` / `scopePath(path)` | A scope name or path in canonical form, or a thrown error |
| `pieceKey(node, salt)` | The key for one piece — hand this to FEE |
| `keyForEnvelope(node, metadata, holding?)` | Derive a piece key from whatever node you hold |
| `writeTarget(grant, key, scope?)` | For a delegate: the ref, scope and key to write a piece, refusing scopes its grant does not cover, and piece grants |
| `holdingOf(grant)` | Which node a grant carries — keyspace, scope or piece — for `keyForEnvelope` |
| `pieceMetadata(ref, { salt, scope?})` | What the envelope must record |
| `pieceNode(metadata)` | The grant node for one piece, `piece:<salt>`, from its envelope metadata |
| `commitment(kk)` | The non-secret check value, recomputable by any `KK` holder |
| `matchesCommitment(kk, recorded)` | Whether a key matches a recorded commitment |
| `KEYSPACE_ID_KEY` / `COMMITMENT_KEY` | FWSS metadata keys for the keyspace id and commitment |
| `grantDescriptor(ref, node)` | Name what a grant unlocks: `'keyspace'`, `'scope:<path>'` or `'piece:<salt>'` |
| `wrapTo(publicKey, key, descriptor)` | Wrap a node key for a recipient |
| `encodeGrant(grant)` / `decodeGrant(bytes)` | A grant to and from its CBOR bytes, for delivery or storage |
| `unwrapWith(privateKey, grant)` | Open a grant, as bytes or decoded |
| `publicKeyOf(privateKey)` | The key-agreement key to publish, derived from a private key |
| `newSalt()` | A fresh per-piece salt |

## Be aware

- **A signature is a bearer credential.** Anything that can elicit the `KeyspaceKey`
  signature for a keyspace can derive that keyspace's keys. Scope is the defence: the
  message names one keyspace, so one careless approval costs one keyspace, not the client's
  whole estate. Day-to-day reads never sign, so a prompt is itself an anomaly.
- **Determinism is checked on every call**, because the whole scheme rests on it. For a
  new keyspace `keyspaceKeys` signs the same message twice and refuses a signer that
  disagrees with itself; for an existing one, it verifies the commitment in `foc/kc` and refuses a key that does not match. 
- **Scopes form a tree, not a graph.** Each scope has exactly one parent, so a scope cannot
  inherit from two (`finance-lead` over both `finance` and `audit`), and each piece carries
  one scope. Both need keys wrapped per parent rather than derived — and somewhere to keep
  those wraps — which is not in this package yet.
- **A scope's position is part of its key.** Moving or renaming a scope re-keys everything
  beneath it, so settle the shape of the tree before writing data under it.
- **scope names travel in the clear** inside the envelope, because the reader needs them to
  derive. For access labels that is a leak of *classification* — an observer learns which
  pieces are `super-secret`, and with a tree, the shape of the hierarchy too. Prefer opaque scope ids, and keep display names in your app.
- **Sharing cannot be undone.** A grant hands over a symmetric key; ending future delivery does not
  recall it. To genuinely cut someone off, move that content to a new scope or keyspace
  and re-encrypt.
- **Beware grant spoofing.** A grant alone proves nothing about who made it. Anyone can
  send one to anyone, with any key inside, which could trick an application into writing
  data encrypted under a key that the attacker holds and real users can't access. Check
  the key before writing with it: a keyspace key against the dataset's `foc/kc` with
  `matchesCommitment`, and a scope key by opening a known piece.
- **Receiving a grant needs a private key in hand.** Session keys and services can
  unwrap; browser wallets, hardware wallets and contract accounts cannot, because none of
  them expose a key to do ECDH with. They need a signature-derived encryption key, which
  is not in this package yet.


