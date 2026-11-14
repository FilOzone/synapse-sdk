# @filoz/keysmith

Deterministic key derivation for robust, recoverable encryption of data on
Filecoin Onchain Cloud.

Keysmith is designed for use with the Filecoin Encryption Envelope (FEE).
Pieces encrypted this way consist of a public envelope followed by encrypted
bytes when stored with a storage provider.

Keysmith provides a mechanism for generating piece encryption keys in a
derivation tree rooted in the owner's wallet, enabling fine-grained
sharing of sections of a payer’s datasets without introducing a key storage
problem: keys can be recovered with the owner's wallet, compatible deterministic
signing, and the encrypted pieces and their envelopes.

Keysmith **generates and derives keys**. It does not encrypt: hand the key
it gives you to FEE ([`filecoin-encryption-envelope`](https://www.npmjs.com/package/filecoin-encryption-envelope))
along with your envelope metadata, and upload that through the Synapse SDK
like any other bytes. When reading, FEE asks Keysmith for the key once it has
read the envelope: see `keyResolver`.

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

`test/claims-vectors.json` does the same for claim chains: presentations a gating provider
must serve or refuse (with the step that refuses them), the EIP-712 type strings, and the
digests of a link and a request, for implementations in other languages.

## Core concepts

- **Group key** is the top level concept: the group key forms the root of the
tree. The group key binds back to the owner's wallet. Anyone holding the
group key can ultimately decrypt any Piece underneath it.
- **Groups** are intermediate nodes on the tree: just like scopes in other
security protocols they are highly flexible and user/application-defined, and
can model metaphors like ‘subfolders’, or ‘roles’, ‘security classification’.
Any of these metaphors (and more!) work, but it would be very dangerous to try
to mix them! Anyone holding a group's key can **read and write** pieces below that
group in the tree, but cannot go up or sideways, allowing apps/users to limit
access to different session keys/apps.
- **Pieces** are all encrypted with a unique key (still deterministically
derived from their group key or group), enabling sharing of individual pieces
of data with others on a safe, ad-hoc basis.

**There is no subdivision below the Piece level**.

ℹ️ NOTE: A group key was previously called a *keyspace*, and a group a *scope*. The wire formats keep
the original spelling so existing keys and encrypted data keep working: the `KeyspaceKey` and
`ReadGrant` EIP-712 types and their `keyspace` fields, the `foc/ks` metadata key, the HKDF info
strings, and the `foc/scope` label and the `'keyspace'` and `'scope:<path>'` grant nodes that this
release writes. Format 2 renames the group label and the nodes; this release reads both and writes
format 1 (see [Format 1 and format 2](#format-1-and-format-2)).

| Term | Meaning |
| --- | --- |
| **group key** (`KK`, `kk`) | The secret root key of one tree, derived from the owner's wallet signature |
| **group key id** (`groupKeyId`) | The public 16 random bytes that name a group key: `foc/ks` in envelopes and dataset metadata. Not a key |
| **key set** (`foc/ks`) | The label that carries the group key id: it names the set of keys derived from one group key |
| **group** | A named subtree, such as `'agent-memory'` or `'top-secret/secret'` |
| **a group's key** (`RK`) | The key for one group, from `keyForGroup` |
| **piece key** | The key for one piece |

| API name | Wire name |
| --- | --- |
| Holding `'groupKey'`; `grantDescriptor(ref, 'keyspace')` | grant node `'keyspace'` (format 2: `'groupKey'`) |
| Holding `{ group }`; `grantDescriptor(ref, 'scope:<path>')` | grant node `'scope:<path>'`, piece label `foc/scope` (format 2: `'group:<path>'`, `foc/group`) |
| Holding `{ piece }` | grant node `'piece:<salt>'` |
| `groupKeyId` | `foc/ks` (key set); EIP-712 `keyspace` |
| `groupKeyCommitment` | `foc/kc` (without `v1.`); EIP-712 `keyspaceCommitment` |
| `GroupKeyMessage { owner, keyspace }` | EIP-712 `KeyspaceKey { owner, keyspace }` |

**Group key initialization signs twice by default to verify deterministic signing.**
Reopening with a recorded commitment signs once. Applications can cache keys or
grants for agent sessions, but recovery requires the owner's wallet, a compatible
deterministic signer, and access to the encrypted pieces and their envelopes.

**Keys are shared by wrapping an encryption key** (any layer of the hierarchy)
under the recipient’s public key (e.g. a key derived from a session private key) into a
structured grant object: about 190 bytes of CBOR.

**Fetching can be gated with the same names.** A share can travel with a signed
*claim chain* proving that a particular session key was granted access to a
given group. It can be verified offline against the piece's FEE metadata.
See [Authenticated grants](#authenticated-grants-claim-chains).

**Each piece’s FEE envelope contains sufficient metadata to identify which
key is needed to decrypt it**, so even if the Piece migrates out of its original
FWSS dataset or was written prior to a key rollover it can be reopened by
suitably authorized actors.

## Group keys

Keys belong to a **group key**, named by a **group key id**: 16 random bytes the client
chooses, which every envelope carries. The id is deliberately independent of FWSS datasets:
replication and repair can put copies of a piece into other datasets, on other
providers, sometimes paid for by other accounts — so tying to FWSS-chosen
identities could lead to issues with recovering keys later. With a user-selected
group key id every copy of a Piece opens with the same key wherever it is fetched
from.

The default choice is one group key per dataset, with the application recording the
group key id (and its commitment) in the dataset metadata when it creates the dataset,
so it never has to remember it.
WARNING: Synapse does not do this for you: the application must pass it through.
Applications can diverge from this behavior if they have good reason to, but
must then make sure to keep track of group keys and know which to use at any given
time.

To re-key, or maintain a hard separation between different sections of data,
simply make a new group key: its keys are then unrelated to the old ones.
Record its id in the metadata when creating a dataset so it can be read
back from the chain.

**IMPORTANT**: Initializing a group key requires the owner's wallet to sign a
specially crafted message twice by default. Once the Group Key (KK) is
available, keys beneath it can be derived without further wallet signatures.
Delegates receive keys through grants. Because this scheme demands deterministic
signatures, signing must happen in a wallet or library that supports RFC 6979.
Keysmith checks this behavior before returning a root KK.

## The key derivation tree

Each group key (`KK`) is the root of its own tree. From it are derived the keys of **groups**
— access labels such as `agent-memory` or `super-secret` — and from either of
those, keys for individual Pieces.

A group is a user/application-chosen access label (string) such as
`agent-memory` or `super-secret`. Groups are the intermediate nodes of the
derivation tree, between the all powerful root and single Pieces and allow
delegation of portions of the entire group key to non-owner actors, processes,
agents or whatever.

Keysmith is unopinionated about how groups are used, or what’s in them, other
than the `/` separator. The `/` allows specification of sub-groups and finer
divisions. Because we’re dealing with strings and need deterministic encoding
each segment must be well-formed Unicode (no lone surrogates), non-empty,
unpadded and without `/`; case is significant. Keysmith normalises valid group
segments to NFC and rejects malformed, empty or padded names.

A group’s key is derived from its parent’s key, so **holding a group means you can
access all data and sub-groups beneath it, but nothing above or beside it**.
Examples:

- Clearance levels/MLS: `top-secret` contains `top-secret/secret`, which contains
`top-secret/secret/official`. A holder of `top-secret/secret` can grant an agent
access to `top-secret/secret/official` and they can happily operate in that
`official` layer without being able to walk back up the tree.
- Naive RBAC: `super-admin` contains `super-admin/admin`, which contains
`super-admin/admin/user`. A holder of `super-admin` can grant a session key access
to `super-admin/admin` and they can happily manage `users` without being able to
walk back up the tree.

This may look counter-intuitive, starting at most privileged and walking outward,
or specifying the whole `top-secret/secret/official` rather than just `official`,
but the way the crypto and grants work saves the entire path to look at and verify
where the grant came from (all the way back to the root) but the actual node key
shared is only the last element of the path. So you can verify up, but only derive
and decrypt down.

## Metadata handling

Keysmith requires no additional key storage: encryption grants can be handled
in whatever way the application currently handles its session keys. It does,
however, use public key recovery metadata in two places:

| Where | Keys | Written | Needed to decrypt? |
| --- | --- | --- | --- |
| FEE envelope (`pieceMetadata`) | `foc/v`, `foc/own`, `foc/ks` (key set), `foc/scope`, `foc/salt` | per piece | **yes** — this is what `keyForEnvelope` reads, and the source of truth |
| FWSS dataset metadata | `foc/ks`, `foc/kc` | once, at `createDataSet` | no — lets a client list its group key ids from the chain, and check its key before decrypting |

### Format 1 and format 2

**This release writes format 1 and reads formats 1 and 2.** A later release switches the writers to
format 2, once the Go port and Curio can read it. Readers accept both formats forever: envelope labels
are authenticated by FEE (they go into the AEAD), and nodes are signed, so what is already stored or
issued can never be edited.

| Format 1 (written now) | Format 2 (read now, written later) |
| --- | --- |
| `foc/v`: `1` | `foc/v`: `2` |
| `foc/own` | `foc/own` |
| `foc/ks` (key set: the group key id) | `foc/ks` (unchanged) |
| `foc/scope` (optional) | `foc/group` (optional) |
| `foc/salt` | `foc/salt` |

The data set key stays `foc/ks` (`GROUP_KEY_ID_KEY`) in both. Format 2 only renames `foc/scope` to
`foc/group`. Each format is strict: a format 2 envelope must not carry `foc/scope`, a format 1
envelope must not carry `foc/group`, and any other `foc/v` is refused with a clear error. That is
the one deliberate tightening of 0.1.0, on both sides: the envelope side refuses `foc/group` in format 1
(and `foc/scope` in format 2), and the claim side refuses labels that carry both `foc/scope` and
`foc/group`. No Keysmith ever wrote either, and Keysmith owns the `foc/` prefix. `readPieceMetadata(metadata)` parses either into
`{ version, owner?, groupKeyId, group?, salt }`; use it instead of reading the labels yourself.
Types: `PieceMetadataV1`, `PieceMetadataV2`, and `PieceMetadata`, an alias of the format written today (V1).

Grant nodes follow the same rename. They are signed (the `ReadGrant` `node` field) and bound into
a wrapped grant's AAD, so a received node string is never rewritten to the other spelling:

| Written now | Also read |
| --- | --- |
| `'keyspace'` | `'groupKey'` |
| `'scope:<path>'` | `'group:<path>'` |
| `'piece:<salt>'` | (unchanged) |

Every comparison reads a node by what it means, not its spelling, so mixed chains are valid (a
`'keyspace'` root delegating to `'group:x'`, or `'scope:a'` to `'group:a/b'`) and widening is refused
across spellings (`'scope:a/b'` to `'group:a'`). Compare nodes the same way: `nodeKind(claim.node).kind === 'groupKey'`
matches both `'keyspace'` and `'groupKey'`. Nodes that code writes anew (`rootClaim`, `delegateClaim`,
`grantDescriptor`) use the format 1 spelling, whichever spelling the caller passes. `wrapTo` and
`unwrapWith` keep the descriptor's spelling, since it is authenticated. Keys never depend on a label
name or a node prefix.

- **No key material lives on chain.** The group key id is public by design; the commitment is a one-way function of a key that is never published.
- **Every piece names its owner.** A provider implementing gated retrieval can use `foc/own` to check that a grant chain is rooted at that owner. This field is for verification, not key derivation; setting it does not enable retrieval gating automatically.
- **All you need when you need it:**
  - When **reading**, the envelope metadata is enough for the caller to know which of
    their derived/granted keys they need to decrypt.
  - When **writing**, the dataset metadata is enough for the caller to derive the
    right encryption key for their new Piece.
- **Group names travel in the clear.** The reader needs them to derive, so an observer
learns which pieces are `super-secret`, and with a tree, the shape of the hierarchy.
If that matters to you, use opaque group ids and map them at the application layer.

The dataset entries also help a writer that has no envelope to draw from yet: it can learn
a dataset's group key id before adding to it. Like all FWSS metadata they are public, so the
group key id goes on chain; no key does.

## Initializing a group key

Starting a group key and rooting it in the wallet requires 2 wallet signatures
(one to generate the key and the second to verify determinism).

To initialize and write an initial piece to a new dataset:

```ts
import * as Keysmith from '@filoz/keysmith'

const ref = {
  owner: account.address,
  groupKeyId: Keysmith.newGroupKeyId(), // or reuse an existing one
}

// For a new group key the wallet signs twice, so Keysmith can check it signs
// deterministically. The signature itself stays inside the call; you get the
// group key, a public commitment, and a descriptor of exactly what was signed.
const { kk, commitment, descriptor } = await Keysmith.deriveGroupKey(account, ref)

// Write the way a delegate does: the group key id comes from what was signed,
// so a stale key or a mistyped ref cannot produce an envelope nobody can open.
const target = Keysmith.writeTarget(descriptor, kk, 'agent-memory')
const salt = Keysmith.newSalt()
const key = Keysmith.pieceKey(target.key, salt) // hand to FEE
const metadata = Keysmith.pieceMetadata(target.ref, { salt, group: target.group }) // goes in the FEE envelope
const encrypted = plaintext.pipeThrough(fee.encrypt({ cek: key, appMetadata: metadata })) // upload these bytes

// Record the group key id and commitment in the createDataSet call you were making anyway:
//   metadata: { [Keysmith.GROUP_KEY_ID_KEY]: ref.groupKeyId, [Keysmith.COMMITMENT_KEY]: commitment }
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
under that group as well as read. However, write access (`addPieces`) is separately
access controlled in FWSS. The application must keep session-key write permissions
aligned with encryption grants; FWSS does not synchronize them automatically.

### Grants on the wire

`wrapTo` returns the grant as an object; `encodeGrant` turns it into bytes to send
or store, and `decodeGrant` reads them back. `unwrapWith` takes either.

```text
grant = {                 ; a CBOR map
  0 => 1,                 ; v: version 1 implies ECDH-ES + A256GCM over secp256k1
  1 => tstr,              ; node: "keyspace" / "scope:<path>" / "piece:<salt>" (format 2 spellings "groupKey" / "group:<path>" are read too)
  2 => bstr .size 20,     ; owner
  3 => bstr .size 16,     ; group key id
  4 => bstr .size 65,     ; epk, the ephemeral public key, uncompressed
  5 => bstr .size 12,     ; iv
  6 => bstr .size 48,     ; ct: the wrapped node key and its tag
  * tstr => any,          ; informational, e.g. "pieceCid": not authenticated
}
```

The authenticated data is `[v, node, owner, groupKeyId]` as deterministic CBOR
(RFC 8949 §4.2.1), with the owner and group key id as bytes, so every implementation
builds the same bytes. `decodeGrant` accepts only canonical CBOR: no indefinite
lengths, duplicate keys, tags, trailing bytes or unknown numbered fields.

When sending a grant to a recipient over a text channel, use a safe
deterministic encoding such as Base64.

### Sharing the entire group key

```ts
// Current custodian, sharing out the whole group key:
const descriptor = Keysmith.grantDescriptor(ref, 'keyspace')
const grant = await Keysmith.wrapTo(Keysmith.publicKeyOf(theirKey), kk, descriptor)
const bytes = Keysmith.encodeGrant(grant)
```

Send the bytes through application channels, e.g. a share link, then:

```ts
// recipient, elsewhere:
const kk = await Keysmith.unwrapWith(myPrivateKey, bytes)
```

With KK, the recipient can derive every encryption key under the group key and
delegate access to any data beneath it. Storage write permissions are still
required to upload new pieces.

### Sharing a group

Sharing a group limits a grant to a logical partition of your dataset. The
recipient can derive keys for that group and its descendants; storage write
permissions are required separately.

To share one **group** instead of the whole group key:

```ts
const rk = Keysmith.keyForGroup(kk, 'agent-memory')
const grant = await Keysmith.wrapTo(theirPublicKey, rk, Keysmith.grantDescriptor(ref, 'scope:agent-memory'))
```

The recipient can then:

- read everything in the `agent-memory` group: all past and future pieces
- encrypt new pieces under the `agent-memory` group
- access, create and delegate sub-groups (e.g. `agent-memory/conversations/1234`)

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
const key = Keysmith.keyForEnvelope(node, metadata, grant) // also checks the piece is in the grant's group key
```

The grant is bound to the salt rather than the CID: the salt is what the key is derived
from, it has one canonical spelling (a piece has several CID spellings), it is known before
upload, and `keyForEnvelope` checks it against the envelope at no cost. The CID needs no
protection: if it is wrong, the recipient fetches a piece with a different salt, and
`keyForEnvelope` refuses it. The recipient reads that one piece and nothing else. A piece grant is read-only, and `writeTarget` refuses it: FEE needs
a fresh key for every object, so a piece key must never encrypt anything else.

A delegate writing pieces should start from its grant rather than assembling the pieces by
hand. `writeTarget` takes the group key id from the grant, checks the group against what
the grant covers, and walks down to the right key:

```ts
const target = Keysmith.writeTarget(grant, key, 'admin/finance/clerks')
const salt = Keysmith.newSalt()
const pieceKey = Keysmith.pieceKey(target.key, salt)
const metadata = Keysmith.pieceMetadata(target.ref, { salt, group: target.group })
```

ℹ️ NOTE: A piece written without a group is readable only with the group key,
or by directly sharing its piece key.

## Authenticated grants: claim chains

A grant hands over a key. It says nothing about who may *fetch* the ciphertext and
does not identify stolen grants (noting that once a key is out, it is out).
Claim chains add a layer of authenticity on top of grants to allow relying parties
(e.g. SPs implementing gated retrieval) to verify that the presenter is the true delegate.

So a share is split in two, using the same node structure and group names:

| | Claim chain | Grant |
| --- | --- | --- |
| Says | bearer B may fetch node N of group key K, and delegate D more levels | the node key, wrapped to B |
| Seen by | the provider, on every gated request | B only, once |
| Lifetime | until the root's `expires` | permanent |

The **root** is an EIP-712 `ReadGrant` signed by the owner's wallet.
Each **later link** is signed by the previous bearer (e.g. a session key) and
can only keep or narrow the group.
The end of the claim chain is a **request** signed by the final bearer to prove
they are the legitimate holder of the grant.

Relying parties can check the claim chain against the piece's FEE metadata (`foc/own`, `foc/ks`,
`foc/scope`, `foc/salt`; or `foc/group` in format 2) with **no on-chain lookups required**.

### Example flows

#### Issuing

The owner, delegating to a session key (one extra wallet prompt beyond group key derivation):

```ts
const { chain, nodeKey } = await Keysmith.rootClaim(wallet, {
  owner, groupKeyId, chainId,
  kk, // from deriveGroupKey(): the node key and the group key commitment are derived from it
  node: 'scope:agent-memory',
  bearer: sessionKeyAddress,
  maxDepth: 1, // the bearer may delegate one more level
  expires: sessionKeyExpiry, // required; unix seconds
})
const grant = await Keysmith.wrapTo(theirPublicKey, nodeKey, Keysmith.grantDescriptor(ref, 'scope:agent-memory'))
const delivery = Keysmith.encodeDelivery(chain, grant) // one blob: send it like a grant
```

`rootClaim` derives the bearer's key itself, so the root cannot commit to a wrong one;
wrap exactly the `nodeKey` it returns. A root for one piece also takes the piece's
labels as `piece`.

#### Receiving

```ts
const { key, claim, chain, grant, expired } = await Keysmith.openDelivery(myPrivateKey, delivery)
```

`openDelivery` checks:

- basic integrity of the claim chain (signatures, group narrowing)
- that it targets the correct key
- that the unwrapped key matches the commitment in its own link, which the
link's issuer signed
- the owner, for a root.

ℹ️ NOTE: It does not know which owner you expect, so the application must check
`claim.owner` and `claim.groupKeyId` itself, based on either the piece being read,
or the dataset being written to.

ℹ️ NOTE: **Keys don't expire; claims do.** An expired delivery still opens, because
the key it wraps decrypts forever whatever the claim says, and `expired` reports it.
Expiry is enforced where the claim is *used*: a gating provider refuses an expired
chain, and so do `signRequest`, `delegateClaim` and `rootClaim`, with "get a new
grant". So an application can keep reading what it already holds, but cannot
fetch from a gating provider, or share onward, on an old claim. Show `expired` to
the user rather than ignoring it: they will need a new grant before fetching.

#### Sub-delegating a narrower node

An application holding a suitably delegated session key can create onward grants:

```ts
const { chain: next, nodeKey } = await Keysmith.delegateClaim(myAccount, chain, {
  parentKey: key, // the key openDelivery() returned
  node: 'scope:agent-memory/notes', bearer: agentAddress, maxDepth: 0,
})
const theirs = Keysmith.encodeDelivery(next, await Keysmith.wrapTo(agentPublicKey, nodeKey, Keysmith.grantDescriptor(ref, 'scope:agent-memory/notes')))
```

`delegateClaim` checks `parentKey` against the delegator's own link and derives the
child's key from it, so an honest delegate cannot hand on a key that is not really below
its own. (A dishonest one can still wrap whatever it likes: the recipient's checks are
only as good as the delegate who signed its link.)

A link to a single piece (`node: 'piece:<salt>'`) also needs the piece's labels as
`piece`, to check the parent reaches it, and can carry its CID as `pieceCid`.

#### Asserting, as the final bearer

```ts
const { chain } = await Keysmith.openDelivery(myPrivateKey, delivery)
const header = await Keysmith.authorizationHeader(myAccount, chain, { pieceCid: CID.parse(cid).bytes })
const response = await fetch(`${serviceURL}/download/${cid}`, { headers: { Authorization: header } })
```

Make a fresh header for each fetch: it expires after `expiresIn` seconds (default 240; at most
`MAX_REQUEST_LIFETIME` plus 60 seconds of clock skew, so 360). `signRequest` and `encodePresentation` are its parts, for a caller that
needs them separately.

#### Holding multiple grants

A bearer may have many grants if they interact with several, disjoint groups. `pickGrant` takes a bundle of grants and picks the narrowest valid grant that reaches the target requested.

```ts
const held = await Promise.all(deliveries.map((bytes) => Keysmith.openDelivery(myPrivateKey, bytes)))
const forRead = Keysmith.pickGrant(held, { piece: labels }, { chainId })               // labels: the envelope's foc/* metadata
const forWrite = Keysmith.pickGrant(held, { owner, groupKeyId, group: 'users/finance' }, { chainId })
// undefined: no grant reaches it; ask for one
```

#### Verifying, as a relying party

For a provider implementing gated retrieval, `verifyPresentation` defines the
checks and throws with the reason for rejecting a presentation.

```ts
const claim = await Keysmith.verifyPresentation(bytes, { pieceCid, piece: envelopeLabels, chainId })
```

#### Sharing with someone who has no key pair

A delivery is wrapped to a bearer's key, so a recipient with no key pair of their own (a
person opening a link in a browser, say) is given one: the sender makes a key pair T, wraps
the grant to T and names T as the bearer, and sends T's private key to the recipient
separately from the delivery:

```ts
const T = generatePrivateKey() // viem/accounts: sent to the recipient on its own channel
const { chain, nodeKey } = await Keysmith.rootClaim(wallet, {
  ...ref, chainId, kk, node: Keysmith.pieceNode(metadata), piece: metadata, pieceCid,
  bearer: privateKeyToAccount(T).address, maxDepth: 0, expires,
})
const descriptor = Keysmith.grantDescriptor(ref, Keysmith.pieceNode(metadata)) // the piece's node, not the group key's
const delivery = Keysmith.encodeDelivery(chain, await Keysmith.wrapTo(Keysmith.publicKeyOf(T), nodeKey, descriptor))

// recipient, with T:
const { key } = await Keysmith.openDelivery(T, delivery)
```

T also signs the recipient's requests to gating providers, so a share link fetches as well as
decrypts.

### Claims on the wire

```text
delivery     = [1, chain, grant]           ; to a new bearer, once; grant = encodeGrant() bytes
presentation = [1, chain, request]         ; to a provider, with each gated request
chain        = [root-link, 0*7 link]       ; root first, at most 8 links

root-link = {
   0 => 1,                                 ; v
   1 => node,
   2 => bstr .size 20,                     ; owner
   3 => bstr .size 16,                     ; group key id
   4 => bstr .size 20,                     ; bearer
   5 => uint .le 255,                      ; maxDepth
   6 => uint .le 9007199254740991,         ; chainId
   7 => bstr .size 16,                     ; keyCommitment of the node key
   8 => signature,                         ; the owner's
 ? 9 => bstr,                              ; pieceCid: a locator only, never signed or checked
  10 => bstr .size 16,                     ; groupKeyCommitment: the dataset's foc/kc, without "v1."
  11 => uint .le 9007199254740991,         ; expires, unix seconds
}
link = {                                   ; every link after the root: no other keys
   0 => 1,
   1 => node,
   4 => bstr .size 20,                     ; bearer
   5 => uint .le 255,                      ; maxDepth
   7 => bstr .size 16,                     ; keyCommitment
   8 => signature,                         ; the previous link's bearer's
 ? 9 => bstr,                              ; pieceCid locator
}
request = {                                ; exactly these keys
   0 => bstr,                              ; pieceCid: the binary CID of the piece being fetched
   1 => uint .le 9007199254740991,         ; expires, unix seconds
   2 => signature,                         ; the final bearer's, over ReadRequest
}

node      = "keyspace" / tstr              ; or "scope:" + canonical group path, or "piece:0x" + 32 lowercase hex digits; "groupKey" and "group:" + path are read too
signature = bstr .size 65                  ; r ‖ s ‖ v, with s ≤ n/2 (low s) and v = 27 or 28
```

Decoders accept exactly one encoding of each value: the bytes must be core deterministic CBOR
(RFC 8949 §4.2.1), which `decodeDelivery` and `decodePresentation` check by re-encoding what they
decoded. So map keys must be in order and text must be well-formed UTF-8, besides the usual
minimal integers, definite lengths, no tags, no duplicate keys and no trailing bytes. Integers
must fit in 53 bits. Unknown keys are refused everywhere. A node must be in canonical form
(`canonicalNode(node) === node`; this keeps the received spelling). `rootClaim`, `delegateClaim` and `signRequest` normalize
whatever their signer returns to low s and v = 27 or 28.

The piece labels are compared in canonical form, never as raw text: `foc/own` as an address,
`foc/ks` and `foc/salt` as lowercase hex, `foc/scope` (format 2: `foc/group`) after `groupPath()`.
`foc/own` is read as 0.1.0 did: absent or falsy means the piece is not gated; a truthy value that is not a
string address is refused. The claim-side functions (`verifyPresentation`, `reaches`, `pickGrant`,
`openDelivery`) take the format from which labels are present (`foc/group` means format 2) and
never read `foc/v`, so a provider may pass it as a string or leave it out. They read only the labels a
decision needs, so a bad `foc/salt` or `foc/scope` is not an error unless the node asks for it.

Every link's signature covers the fields it inherits from the root, so a link cannot be moved
under a root that differs in any of them, and nobody below the owner can change the root's
commitments or expiry. Links name their parent by its bearer's address, not by hash, so a parent
can be re-issued without invalidating the links beneath it. The EIP-712 domain is the
`KeyspaceKey` one, `{ name: 'FOC Encryption', version: '1' }`; the types are exported as
`READ_GRANT_TYPES` and `READ_REQUEST_TYPES`.

## Reading a piece

The FEE envelope carries everything a reader needs, so there is no index to
keep in sync, and it does not matter which dataset or provider the copy came
from.

FEE reads the envelope, then asks for the key: give it a `keyResolver` for
whatever key you hold, and Keysmith derives the piece key from the envelope's
own metadata.

```ts
import * as fee from 'filecoin-encryption-envelope'

// the group key: walks down into whatever group the metadata names
await encrypted.pipeThrough(fee.decrypt(Keysmith.keyResolver(kk))).pipeTo(sink)

// a group's key: say which group it is, and it walks down from there
fee.decrypt(Keysmith.keyResolver(rk, { group: 'agent-memory' }))

// a piece key: nothing to derive, but it opens only the piece whose salt it names
fee.decrypt(Keysmith.keyResolver(pk, { piece: salt }))
```

`KK`, `RK` and a piece key are all 32 bytes of HKDF output, so nothing in the
envelope says which one you are holding — you have to tell it. The grant that
delivered the key holds this information, so keep the whole grant when
receiving a share and pass it to the derivation. Given the grant, Keysmith also checks
the piece's `foc/own` and `foc/ks` against it, so a key from the wrong group key fails with
a clear reason rather than as a FEE decryption error:

```ts
fee.decrypt(Keysmith.keyResolver(node, grant))
```

The metadata FEE hands the resolver is not yet authenticated: Keysmith checks it
as strictly as any envelope, and a tampered label yields a key the content tags
reject. For a range read, derive the key yourself and pass it to FEE:

```ts
const info = await fee.parse(source)
if (info.scheme !== 'chunked') throw new Error('Range reads need a chunked envelope')
const key = Keysmith.keyForEnvelope(node, info.appMetadata, grant)
const { stream } = await fee.decryptRange(source, key, { offset, length }, { params: info.params })
```

## Recovery

Recovery requires the owner's wallet, a compatible signer that can reproduce the
original signatures, and accessible encrypted pieces with their envelopes. It
cannot recover a lost wallet or missing stored data.

1. List the wallet's datasets, and fetch their pieces. A dataset's `GROUP_KEY_ID_KEY`
   metadata says which group key id to expect, but **each envelope is the source of truth**:
   read `foc/ks` from it.
2. Call `deriveGroupKey` once per distinct group key id. Pass a recorded commitment only
   when the dataset's `foc/ks` matches the envelope's group key id. With that commitment,
   it signs once and throws before anything is decrypted if the key does not match.
   For matching dataset metadata:

   ```ts
   const { kk } = await Keysmith.deriveGroupKey(
     wallet,
     { owner, groupKeyId: Keysmith.groupKeyId(datasetMetadata[Keysmith.GROUP_KEY_ID_KEY]) },
     { commitment: datasetMetadata[Keysmith.COMMITMENT_KEY] } // wrong wallet, or a signer that is not deterministic, throws
   )
   ```

   Where a dataset recorded no matching commitment, leave it out: `deriveGroupKey`
   signs twice instead. Successful FEE decryption confirms that the derived key
   opens the piece.
3. Derive each piece key from the metadata in its own envelope.

A copy found in a dataset other than the one it was written to opens exactly the same way:
the envelope, not the dataset, names its group key id. Because the commitment is derived from
`KK`, anything holding the group key — an agent replicating data, say — can record it in
a new dataset's metadata too.

## API

| Function | Purpose |
| --- | --- |
| `newGroupKeyId()` | A fresh group key id |
| `groupKeyId(id)` | A group key id in canonical form (lowercase `0x` + 32 hex digits), or a thrown error |
| `groupKeyMessage(ref)` | The EIP-712 message an owner signs for a group key: `{ owner, keyspace }` |
| `deriveGroupKey(signer, ref, { commitment?, verifySigner?, password? })` | One owner signature per group key (two without a recorded commitment) → `{ kk, commitment, descriptor }` |
| `keyForGroup(kk, path)` | The key for a group, e.g. `'super-secret/secret'` |
| `groupName(name)` / `groupPath(path)` | A group name or path in canonical form, or a thrown error |
| `pieceKey(node, salt)` | The key for one piece — hand this to FEE |
| `keyForEnvelope(node, metadata, grant or holding?)` | Derive a piece key from whatever node you hold; given the grant, also checks the piece's owner and group key |
| `keyResolver(node, grant or holding?)` | The same, as a FEE key resolver: `fee.decrypt(keyResolver(node, grant))` |
| `writeTarget(grant, key, group?)` | For a delegate: the ref, group and key to write a piece, refusing groups its grant does not cover, and piece grants |
| `holdingOf(grant)` | Which node a grant carries — group key, group or piece — for `keyForEnvelope` |
| `pieceMetadata(ref, { salt, group? })` | What the envelope must record: format 1, as `PieceMetadata` |
| `readPieceMetadata(metadata)` | An envelope's labels, format 1 or 2, as `{ version, owner?, groupKeyId, group?, salt }`; refuses a mixed or unknown format |
| `nodeKind(node)` | What a grant node means, in either spelling: `{ kind: 'groupKey' }`, `{ kind: 'group', path }` or `{ kind: 'piece', salt }` |
| `pieceNode(metadata)` | The grant node for one piece, `piece:<salt>`, from its envelope metadata (either format) |
| `commitment(kk)` | The non-secret check value, recomputable by any `KK` holder |
| `matchesCommitment(kk, recorded)` | Whether a key matches a recorded commitment |
| `GROUP_KEY_ID_KEY` / `COMMITMENT_KEY` | FWSS metadata keys for the group key id (`foc/ks`, key set) and commitment (`foc/kc`) |
| `grantDescriptor(ref, node)` | Name what a grant unlocks: `'keyspace'`, `'scope:<path>'` or `'piece:<salt>'`; the format 2 spellings are accepted and written as these |
| `wrapTo(publicKey, key, descriptor)` | Wrap a node key for a recipient |
| `encodeGrant(grant)` / `decodeGrant(bytes)` | A grant to and from its CBOR bytes, for delivery or storage |
| `unwrapWith(privateKey, grant)` | Open a grant, as bytes or decoded |
| `publicKeyOf(privateKey)` | The key-agreement key to publish, derived from a private key |
| `newSalt()` | A fresh per-piece salt |
| `rootClaim(wallet, { owner, groupKeyId, chainId, kk, node, bearer, maxDepth, expires, piece?, pieceCid?, now? })` | The owner-signed root of a claim chain → `{ chain, nodeKey }`; refuses an `expires` already past |
| `delegateClaim(signer, chain, { parentKey, node, bearer, maxDepth, piece?, pieceCid?, now? })` | A narrower link, signed by the chain's final bearer, with its key derived from `parentKey` → `{ chain, nodeKey }`; refuses an expired chain |
| `encodeDelivery(chain, grant)` / `decodeDelivery(bytes)` | A claim chain and its grant, as one blob for the new bearer |
| `openDelivery(privateKey, bytes, { now?, piece? })` | Verify a delivery and unwrap its key, checked against the owner-signed commitment; opens an expired one, reporting `expired` |
| `signRequest(signer, chain, { pieceCid, expires, now? })` | A request for one piece, by the final bearer; any provider holding it may serve it. Refuses an expired chain, or an `expires` more than `MAX_REQUEST_LIFETIME` ahead or already past |
| `authorizationHeader(signer, chain, { pieceCid, expiresIn?, now? })` | `FOC-Grant <base64url presentation>`, the `Authorization` header for one gated request. Refuses as `signRequest` does |
| `encodePresentation(chain, request)` / `decodePresentation(bytes)` | The `Authorization: FOC-Grant` payload |
| `verifyChain(chain, { now?, piece? })` | Check a chain on its own: signatures, expiry, narrowing |
| `verifyPresentation(bytes, { pieceCid, piece, chainId, now? })` | What a gating provider checks; the reference verifier |
| `reaches(node, labels)` | Whether a node covers a piece, from its envelope labels |
| `pickGrant(grants, target, { chainId, now? })` | The narrowest live grant (anything with a `claim`, such as `openDelivery`'s result) reaching a piece or a group |
| `keyCommitmentOf(key)` | The 16-byte key commitment a link carries |

## Be aware

- **A signature is a bearer credential.** Anything that can elicit the `KeyspaceKey`
  signature for a group key can derive that group key's keys. Narrowness is the defence: the
  message names one group key, so one careless approval costs one group key, not the client's
  whole estate. Day-to-day reads never sign, so a prompt is itself an anomaly.
  For more, pass a `password`: the key then also needs it, so a signature alone is not
  enough. It is stretched with Argon2id (m = 64 MiB, t = 3, p = 1, salted with the
  signed message's EIP-712 hash) and becomes the HKDF salt. The trade-off is recovery:
  forget the password and the group key is gone, and nothing can bring it back.
- **Determinism is checked by default**, because the whole scheme rests on it.
  Without a recorded commitment, `deriveGroupKey` signs the same message twice and
  refuses a signer that disagrees with itself. With a commitment in `foc/kc`, it
  verifies the derived key against that value and refuses a key that does not match.
- **Groups form a tree, not a graph.** Each group has exactly one parent, so a group cannot
  inherit from two (`finance-lead` over both `finance` and `audit`), and each piece carries
  one group. Both need keys wrapped per parent rather than derived — and somewhere to keep
  those wraps — which is not in this package yet.
- **A group's position is part of its key.** Moving or renaming a group changes the
  keys derived beneath it. Existing pieces retain their old labels and keys, so
  settle the shape of the tree before writing data under it.
- **Group names travel in the clear** inside the envelope, because the reader needs them to
  derive. For access labels that is a leak of *classification* — an observer learns which
  pieces are `super-secret`, and with a tree, the shape of the hierarchy too. Prefer opaque
  group ids, and keep display names in your app.
- **Sharing cannot be undone.** A grant hands over a symmetric key; ending future delivery
  does not recall it. To exclude a recipient from new versions, create a new group key
  and re-encrypt with keys that have not been shared with them. A child group does not
  exclude an ancestor-key holder. Previously shared keys and copies remain usable.
- **Claim chains can expire but they cannot be revoked early.** Relying parties check
  them without on-chain lookups, so revoking the bearer's session key stops its writes but
  not its fetching until the root's `expires`. Keep claims short-lived if that window
  matters, and set their expiry no later than the related session key's expiry. Expiry
  ends fetching from gating providers, never decryption: a key already delivered keeps working.
- **Beware grant spoofing.** A grant alone proves nothing about who made it. Anyone can
  send one to anyone, with any key inside, which could trick an application into writing
  data encrypted under a key that the attacker holds and real users can't access. A
  delivery narrows this: `openDelivery` checks the key against the commitment its issuer
  signed, so check `claim.owner` and `claim.groupKeyId` against the owner and group key id
  you expect. A delegated key is only as honest as the delegate who signed its link.
  For a bare grant, check the key before writing with it: a group key against the
  dataset's `foc/kc` with `matchesCommitment`, and a group’s key by opening a known piece.
- **Receiving a grant needs a private key in hand.** Session keys and services can
  unwrap; browser wallets, hardware wallets and contract accounts cannot, because none of
  them expose a key to do ECDH with. They need a signature-derived encryption key, which
  is not in this package yet.
