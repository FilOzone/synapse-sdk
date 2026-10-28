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

**Fetching can be gated with the same names.** A share can travel with a signed
*claim chain* proving that a particular session key was granted access to a
given scope. It can be verified offline against the the piece's FEE metadata.
See [Gated retrieval](#gated-retrieval-claim-chains).

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

The default choice is one keyspace per dataset, with the application recording the
keyspace id (and its commitment) in the dataset metadata when it creates the dataset,
so it never has to remember it.
WARNING: Synapse does not do this for you: the application must pass it through.
Applications can diverge from  this behavior if they have good reason to, but
must then make sure to keep track of keyspaces and know which to use at any given
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
each segment is well-formed Unicode (no lone surrogates) in NFC, non-empty,
unpadded and without `/`; case is significant. Keysmith refuses a non-canonical
name rather than silently normalising it and generating mismatched keys.

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
const encrypted = plaintext.pipeThrough(fee.encrypt({ cek: key, appMetadata: metadata })) // upload these bytes

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
const key = Keysmith.keyForEnvelope(node, metadata, grant) // also checks the piece is in the grant's keyspace
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

```ts
const target = Keysmith.writeTarget(grant, key, 'admin/finance/clerks')
const salt = Keysmith.newSalt()
const pieceKey = Keysmith.pieceKey(target.key, salt)
const metadata = Keysmith.pieceMetadata(target.ref, { salt, scope: target.scope })
```

ℹ️ NOTE: A piece written without a scope is readable only with the keyspace key,
or by directly sharing its piece key.

## Authenticated grants: claim chains

A grant hands over a key. It says nothing about who may *fetch* the ciphertext, nor
identify stolen grants (noting that once a key is out, it is out).
Claim chains add a layer of authenticity on top of grants to allow relying parties
(eg SPs gating retrievals) to verify that the presenter is the true delegate.

So a share is split in two, using the same node structure and scope names:

| | Claim chain | Grant |
| --- | --- | --- |
| Says | bearer B may fetch node N of keyspace K, and delegate D more levels | the node key, wrapped to B |
| Seen by | the provider, on every gated request | B only, once |
| Lifetime | until the root's `expires` | permanent |

The **root** is an EIP-712 `ReadGrant` signed by the owner's wallet.
Each **later link** is signed by the previous bearer (eg session key) and
can only keep or narrow the scope. 
The end of the claim chain is a **request** signed by the final bearer to prove
they are the legitimate holder of the grant.

Relying parties can checks the claim chain against the piece's FEE metadata (`foc/own`, `foc/ks`,
`foc/scope`, `foc/salt`) with **no chain lookups required**.

### Example flows

#### Issuing

The owner, delegating to a session key (one extra wallet prompt, beside the `KeyspaceKey` one):

```ts
const { chain, nodeKey } = await Keysmith.rootClaim(wallet, {
  owner, keyspace, chainId,
  kk, // from keyspaceKeys(): the node key and the keyspace commitment are derived from it
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
 * basic integrity of the claim chain (signatures, scope narrowing)
 * that it targets the correct key
 * that the unwrapped key matches the commitment in its own link, which the
link's issuer signed
 * the owner, for a root. 
 
ℹ️ NOTE: It does not know which owner you expect, so the application must check
`claim.owner` and `claim.keyspace` itself, based on either the piece being read,
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
const request = await Keysmith.signRequest(myAccount, chain, {
  pieceCid: CID.parse(cid).bytes, expires: Math.floor(Date.now() / 1000) + 120,
})
// the Authorization header value; base64url is yours (Keysmith has no text encoding)
const header = `FOC-Grant ${base64url(Keysmith.encodePresentation(chain, request))}`
```

#### Verifying, as a relying party

Verifying, as a provider: `verifyPresentation` is the reference for what a gating
provider checks, and throws with the reason it refuses.

```ts
const claim = await Keysmith.verifyPresentation(bytes, { pieceCid, piece: envelopeLabels, chainId })
```

#### Sharing with someone who has no key pair

A delivery is wrapped to a bearer's key, so a recipient with no key pair of their own (a
person opening a link in a browser, say) is given one: the sender makes a key pair T, wraps
the grant to T and names T as the bearer, and gets T's private key to the recipient. Either
send it separately, or derive it from a password so no key travels at all:

```ts
const salt = crypto.getRandomValues(new Uint8Array(16)) // travels with the link
const T = await Keysmith.shareKeyFromPassword(password, salt)
const { chain, nodeKey } = await Keysmith.rootClaim(wallet, {
  ...ref, chainId, kk, node: Keysmith.pieceNode(metadata), piece: metadata, pieceCid,
  bearer: privateKeyToAccount(T).address, maxDepth: 0, expires,
})
const delivery = Keysmith.encodeDelivery(chain, await Keysmith.wrapTo(Keysmith.publicKeyOf(T), nodeKey, descriptor))

// recipient, with the password and the salt:
const { key } = await Keysmith.openDelivery(await Keysmith.shareKeyFromPassword(password, salt), delivery)
```

T also signs the recipient's requests to gating providers, so a share link fetches as well as
decrypts. Anyone holding the link can guess passwords offline, at about a second of scrypt
each, so use long ones.

### Claims on the wire

```text
delivery     = [1, chain, grant]           ; to a new bearer, once; grant = encodeGrant() bytes
presentation = [1, chain, request]         ; to a provider, with each gated request
chain        = [root-link, 0*7 link]       ; root first, at most 8 links

root-link = {
   0 => 1,                                 ; v
   1 => node,
   2 => bstr .size 20,                     ; owner
   3 => bstr .size 16,                     ; keyspace
   4 => bstr .size 20,                     ; bearer
   5 => uint .le 255,                      ; maxDepth
   6 => uint .le 9007199254740991,         ; chainId
   7 => bstr .size 16,                     ; keyCommitment of the node key
   8 => signature,                         ; the owner's
 ? 9 => bstr,                              ; pieceCid: a locator only, never signed or checked
  10 => bstr .size 16,                     ; keyspaceCommitment: the dataset's foc/kc, without "v1."
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

node      = "keyspace" / tstr              ; or "scope:" + canonical scope path, or "piece:0x" + 32 lowercase hex digits
signature = bstr .size 65                  ; r ‖ s ‖ v, with s ≤ n/2 (low s) and v = 27 or 28
```

Decoders accept exactly one encoding of each value: the bytes must be core deterministic CBOR
(RFC 8949 §4.2.1), which `decodeDelivery` and `decodePresentation` check by re-encoding what they
decoded. So map keys must be in order and text must be well-formed UTF-8, besides the usual
minimal integers, definite lengths, no tags, no duplicate keys and no trailing bytes. Integers
must fit in 53 bits. Unknown keys are refused everywhere. A node must be in canonical form
(`canonicalNode(node) === node`). `rootClaim`, `delegateClaim` and `signRequest` normalize
whatever their signer returns to low s and v = 27 or 28.

The piece labels are compared in canonical form, never as raw text: `foc/own` as an address,
`foc/ks` and `foc/salt` as lowercase hex, `foc/scope` after `scopePath()`.

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

// the keyspace key: walks down into whatever scope the metadata names
await encrypted.pipeThrough(fee.decrypt(Keysmith.keyResolver(kk))).pipeTo(sink)

// a scope key: say which scope it is, and it walks down from there
fee.decrypt(Keysmith.keyResolver(rk, { scope: 'agent-memory' }))

// a piece key: nothing to derive, but it opens only the piece whose salt it names
fee.decrypt(Keysmith.keyResolver(pk, { piece: salt }))
```

`KK`, `RK` and a piece key are all 32 bytes of HKDF output, so nothing in the
envelope says which one you are holding — you have to tell it. The grant that
delivered the key holds this information, so keep the whole grant when
receiving a share and pass it to the derivation. Given the grant, Keysmith also checks
the piece's `foc/own` and `foc/ks` against it, so a key from the wrong keyspace fails with
a clear reason rather than as a FEE decryption error:

```ts
fee.decrypt(Keysmith.keyResolver(node, grant))
```

The metadata FEE hands the resolver is not yet authenticated: Keysmith checks it
as strictly as any envelope, and a tampered label yields a key the content tags
reject. For a range read, derive the key yourself and pass it to FEE:

```ts
const info = await fee.parse(source)
const key = Keysmith.keyForEnvelope(node, info.appMetadata, grant)
const { stream } = await fee.decryptRange(source, key, { offset, length }, { params: info.params })
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
| `keyForEnvelope(node, metadata, grant or holding?)` | Derive a piece key from whatever node you hold; given the grant, also checks the piece's owner and keyspace |
| `keyResolver(node, grant or holding?)` | The same, as a FEE key resolver: `fee.decrypt(keyResolver(node, grant))` |
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
| `rootClaim(wallet, { owner, keyspace, chainId, kk, node, bearer, maxDepth, expires, piece?, pieceCid?, now? })` | The owner-signed root of a claim chain → `{ chain, nodeKey }`; refuses an `expires` already past |
| `delegateClaim(signer, chain, { parentKey, node, bearer, maxDepth, piece?, pieceCid?, now? })` | A narrower link, signed by the chain's final bearer, with its key derived from `parentKey` → `{ chain, nodeKey }`; refuses an expired chain |
| `encodeDelivery(chain, grant)` / `decodeDelivery(bytes)` | A claim chain and its grant, as one blob for the new bearer |
| `openDelivery(privateKey, bytes, { now?, piece? })` | Verify a delivery and unwrap its key, checked against the owner-signed commitment; opens an expired one, reporting `expired` |
| `signRequest(signer, chain, { pieceCid, expires, now? })` | A request for one piece, by the final bearer; any provider holding it may serve it. Refuses an expired chain |
| `shareKeyFromPassword(password, salt)` | A bearer's private key from a password and a 16-byte salt (`pw1`), for sharing with someone who has no key pair |
| `encodePresentation(chain, request)` / `decodePresentation(bytes)` | The `Authorization: FOC-Grant` payload |
| `verifyChain(chain, { now?, piece? })` | Check a chain on its own: signatures, expiry, narrowing |
| `verifyPresentation(bytes, { pieceCid, piece, chainId, now? })` | What a gating provider checks; the reference verifier |
| `reaches(node, labels)` | Whether a node covers a piece, from its envelope labels |
| `keyCommitmentOf(key)` | The 16-byte key commitment a link carries |

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
  pieces are `super-secret`, and with a tree, the shape of the hierarchy too. Prefer opaque
  scope ids, and keep display names in your app.
- **Sharing cannot be undone.** A grant hands over a symmetric key; ending future delivery
  does not recall it. To genuinely cut someone off, move that content to a new scope or
  keyspace and re-encrypt.
- **Claim chains can expire but they cannot be revoked early.** Relying parties check
  them without the claim chain, so revoking the bearer's session key stops its writes but
  not its fetching  until the root's `expires`. Keep session keys short-lived if that window
  matters, and remember to set the expiry on the claim to match. Expiry ends fetching from
  gating providers, never decryption: a key already delivered keeps working.
- **Beware grant spoofing.** A grant alone proves nothing about who made it. Anyone can
  send one to anyone, with any key inside, which could trick an application into writing
  data encrypted under a key that the attacker holds and real users can't access. A
  delivery narrows this: `openDelivery` checks the key against the commitment its issuer
  signed, so once you have checked `claim.owner` is the owner you expect, a root-issued key
  is the owner's own. A delegated key is only as honest as the delegate who signed its link.
  For a bare grant, check the key before writing with it: a keyspace key against the
  dataset's `foc/kc` with `matchesCommitment`, and a scope key by opening a known piece.
- **Receiving a grant needs a private key in hand.** Session keys and services can
  unwrap; browser wallets, hardware wallets and contract accounts cannot, because none of
  them expose a key to do ECDH with. They need a signature-derived encryption key, which
  is not in this package yet.


