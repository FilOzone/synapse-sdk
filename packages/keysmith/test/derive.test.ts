import { secp256k1 } from '@noble/curves/secp256k1'
import assert from 'assert'
import { bytesToHex, hashDomain, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  commitment,
  DOMAIN,
  grantDescriptor,
  holdingOf,
  keyForEnvelope,
  keyspaceId,
  keyspaceKeyMessage,
  keyspaceKeys,
  lowSrs,
  matchesCommitment,
  newKeyspace,
  newSalt,
  pieceKey,
  pieceMetadata,
  pieceNode,
  scopeKey,
  scopeName,
  scopePath,
  writeTarget,
} from '../src/derive.ts'
import type { KeyspaceRef, TypedDataSigner } from '../src/types.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: KeyspaceRef = { owner: account.address, keyspace: '0x00112233445566778899aabbccddeeff' }
const kkOf = async (signer: TypedDataSigner, r: KeyspaceRef) => (await keyspaceKeys(signer, r)).kk

/** A real signer with a call counter, so prompts can be counted. */
function counting(signer: TypedDataSigner) {
  const wrapper = {
    calls: 0,
    signTypedData: (args: Parameters<TypedDataSigner['signTypedData']>[0]) => {
      wrapper.calls++
      return signer.signTypedData(args)
    },
  }
  return wrapper
}

describe('keyspaceKeyMessage', () => {
  it('names the owner and keyspace, and signs nothing about chains or datasets', () => {
    const message = keyspaceKeyMessage(ref)
    assert.equal(message.keyspace, ref.keyspace)
    assert.deepStrictEqual(Object.keys(message).sort(), ['keyspace', 'owner'])
  })
})

describe('keyspaceKeys', () => {
  it('derives the same key for the same wallet and keyspace', async () => {
    assert.deepStrictEqual(await kkOf(account, ref), await kkOf(account, ref))
  })

  it('derives an unrelated key for another keyspace, or another wallet', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    assert.notDeepStrictEqual(await kkOf(account, ref), await kkOf(account, { ...ref, keyspace: newKeyspace() }))
    assert.notDeepStrictEqual(await kkOf(account, ref), await kkOf(other, { ...ref, owner: other.address }))
  })

  it('accepts the keyspace in any case, since it is canonicalised before signing', async () => {
    const upper = ref.keyspace.toUpperCase().replace('0X', '0x') as `0x${string}`
    assert.deepStrictEqual(await kkOf(account, ref), await kkOf(account, { ...ref, keyspace: upper }))
  })

  it('returns a commitment derived from the keyspace key, so any key holder can recompute it', async () => {
    const { kk, commitment: c } = await keyspaceKeys(account, ref)
    assert.equal(c, commitment(kk))
    assert.match(c, /^v1\.[0-9a-f]{32}$/)
    assert.notEqual(c, (await keyspaceKeys(account, { ...ref, keyspace: newKeyspace() })).commitment)
    assert.ok(!c.includes(bytesToHex(kk).slice(2, 34)), 'the commitment must not contain the key')
  })

  it('refuses a signature from any wallet but the owner’s, a session key included', async () => {
    const session = privateKeyToAccount(generatePrivateKey())
    await assert.rejects(keyspaceKeys(session, ref), /not from the keyspace owner/)
    const ownerInOtherCase = { ...ref, owner: account.address.toLowerCase() as `0x${string}` }
    await keyspaceKeys(account, ownerInOtherCase)
  })

  it('returns the keyspace descriptor, so an owner writes the way a delegate does', async () => {
    const { kk, descriptor } = await keyspaceKeys(account, ref)
    assert.deepStrictEqual(descriptor, grantDescriptor(ref, 'keyspace'))
    const target = writeTarget(descriptor, kk, 'agent-memory')
    const salt = newSalt()
    const metadata = pieceMetadata(target.ref, { salt, scope: target.scope })
    assert.equal(metadata['foc/ks'], ref.keyspace, 'the keyspace comes from what was signed')
    assert.deepStrictEqual(pieceKey(target.key, salt), keyForEnvelope(kk, metadata))
  })

  it('signs twice for a new keyspace, and once for one with a recorded commitment', async () => {
    const signer = counting(account)
    const { kk, commitment: kc } = await keyspaceKeys(signer, ref)
    assert.equal(signer.calls, 2, 'new keyspace: sign, sign again, compare')
    await keyspaceKeys(signer, ref)
    assert.equal(signer.calls, 4, 'nothing is remembered between calls')
    const reopened = await keyspaceKeys(signer, ref, { commitment: kc })
    assert.equal(signer.calls, 5, 'existing keyspace: the commitment does the checking')
    assert.deepStrictEqual(reopened.kk, kk)
    await keyspaceKeys(signer, ref, { commitment: kc, verifySigner: true })
    assert.equal(signer.calls, 7, 'checking can be forced')
    await keyspaceKeys(signer, ref, { verifySigner: false })
    assert.equal(signer.calls, 8, 'or skipped for a signer already vetted')
  })

  it('refuses a key that does not match the recorded commitment', async () => {
    const other = await keyspaceKeys(account, { ...ref, keyspace: newKeyspace() })
    await assert.rejects(
      keyspaceKeys(account, ref, { commitment: other.commitment }),
      /does not match the recorded commitment/
    )
    await assert.rejects(keyspaceKeys(account, ref, { commitment: 'v1.0.00' }), /format v1/)
  })

  it('rejects a randomising signer, and anything that is not plain ECDSA', async () => {
    let calls = 0
    const r = bytesToHex(new Uint8Array(32).fill(1))
    const flaky: TypedDataSigner = {
      signTypedData: async () => `${r}${(++calls).toString(16).padStart(64, '0')}1b` as const,
    }
    await assert.rejects(keyspaceKeys(flaky, ref), /not deterministic/)
    const abiLike: TypedDataSigner = {
      signTypedData: async () => `0x${'20'.padStart(64, '0')}${'41'.padStart(64, '0')}${'ab'.repeat(65)}` as const,
    }
    await assert.rejects(keyspaceKeys(abiLike, ref), /64- or 65-byte/)
  })
})

describe('lowSrs', () => {
  const r = bytesToHex(new Uint8Array(32).fill(0xab))
  const asSig = (s: bigint, v = '1b') => `${r}${s.toString(16).padStart(64, '0')}${v}` as `0x${string}`

  it('drops v and normalises a high-S signature to the low form', () => {
    const low = 0x0123456789abcdefn
    assert.deepStrictEqual(lowSrs(asSig(low, '1b')), lowSrs(asSig(secp256k1.CURVE.n - low, '1c')))
    assert.deepStrictEqual(lowSrs(asSig(7n, '')), lowSrs(asSig(7n)), '64-byte r‖s with no v is fine')
  })

  it('rejects other lengths, and r or s outside [1, n−1]', () => {
    assert.throws(() => lowSrs('0xdeadbeef'), /64- or 65-byte/)
    assert.throws(() => lowSrs(`${asSig(7n)}00`), /64- or 65-byte/)
    assert.throws(() => lowSrs(asSig(0n)), /\[1, n−1\]/)
    assert.throws(() => lowSrs(asSig(secp256k1.CURVE.n)), /\[1, n−1\]/)
  })
})

describe('EIP-712 domain', () => {
  const EIP712Domain = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
  ] as const
  const separator = () => hashDomain({ domain: DOMAIN, types: { EIP712Domain } })

  it('is pinned — changing it orphans every key ever derived', () => {
    assert.deepStrictEqual(DOMAIN, { name: 'FOC Encryption', version: '1' })
    assert.equal(separator(), '0x547bad88c79d4d4f2d88253da28d0b6dd21bb4aa20bbfa20d2f05b55335697b2')
  })

  it('omits chainId and verifyingContract, and absent is not zero', () => {
    assert.equal('chainId' in DOMAIN, false)
    assert.equal('verifyingContract' in DOMAIN, false)
    const zeroed = hashDomain({
      domain: { ...DOMAIN, chainId: 0n, verifyingContract: '0x0000000000000000000000000000000000000000' },
      types: {
        EIP712Domain: [
          ...EIP712Domain,
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ] as const,
      },
    })
    assert.notEqual(zeroed, separator())
  })
})

describe('location independence', () => {
  it('derives a piece key from the envelope alone, wherever the piece now lives', async () => {
    // Replication and repair put copies of a piece into other datasets, under
    // other FWSS ids, possibly other payers. None of that is an input here.
    const kk = await kkOf(account, ref)
    const salt = newSalt()
    const foundElsewhere = JSON.parse(JSON.stringify(pieceMetadata(ref, { salt })))
    assert.deepStrictEqual(keyForEnvelope(kk, foundElsewhere), pieceKey(kk, salt))
  })

  it('refuses an envelope in any other format, clearly', async () => {
    const kk = await kkOf(account, ref)
    const prototype = { 'foc/v': 1, 'foc/cds': '0x2a', 'foc/epoch': 0, 'foc/salt': newSalt() } as never
    assert.throws(() => keyForEnvelope(kk, prototype), /format 1 with a keyspace/, 'a pre-release prototype')
    const future = { ...pieceMetadata(ref, { salt: newSalt() }), 'foc/v': 2 } as never
    assert.throws(() => keyForEnvelope(kk, future), /format 1 with a keyspace/)
  })
})

describe('scopes', () => {
  it('give a keyspace holder and a scope holder the same piece key', async () => {
    const kk = await kkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), scope: 'agent-memory' })
    assert.deepStrictEqual(
      keyForEnvelope(kk, metadata),
      keyForEnvelope(scopeKey(kk, 'agent-memory'), metadata, { scope: 'agent-memory' })
    )
  })

  it('say so when a scope key is used on a piece with no scope', async () => {
    const kk = await kkOf(account, ref)
    const unlabelled = pieceMetadata(ref, { salt: newSalt() })
    assert.throws(
      () => keyForEnvelope(scopeKey(kk, 'agent-memory'), unlabelled, { scope: 'agent-memory' }),
      /does not contain/
    )
  })

  it('are canonicalised: NFC, case kept, no padding', async () => {
    const kk = await kkOf(account, ref)
    assert.deepStrictEqual(scopeKey(kk, 'café'), scopeKey(kk, 'café'))
    assert.notDeepStrictEqual(scopeKey(kk, 'Finance'), scopeKey(kk, 'finance'))
    assert.equal(scopeName('café'), 'café')
    assert.throws(() => scopeKey(kk, ''), /non-empty/)
    assert.throws(() => pieceMetadata(ref, { salt: newSalt(), scope: 'secret ' }), /whitespace/)
  })
})

describe('holdingOf', () => {
  it('reads the level back off a grant, and refuses what it does not understand', () => {
    assert.equal(holdingOf({ node: 'keyspace' }), 'keyspace')
    assert.deepStrictEqual(holdingOf({ node: 'scope:agent-memory' }), { scope: 'agent-memory' })
    assert.throws(() => holdingOf({ node: 'dataset' }), /Unrecognised grant node/)
    assert.throws(() => holdingOf({ node: 'role:invoices' }), /Unrecognised grant node/)
  })
})

describe('pieceMetadata and grantDescriptor', () => {
  it('record what a reader needs, in canonical form, and nothing secret', () => {
    const salt = '0x00CDEF0123456789ABCDEF0123456789' as const
    assert.deepStrictEqual(pieceMetadata(ref, { salt, scope: 'café' }), {
      'foc/v': 1,
      'foc/own': account.address.toLowerCase(),
      'foc/ks': ref.keyspace,
      'foc/scope': 'café',
      'foc/salt': '0x00cdef0123456789abcdef0123456789',
    })
    assert.deepStrictEqual(grantDescriptor(ref, 'scope:café'), {
      v: 1,
      node: 'scope:café',
      owner: account.address.toLowerCase(),
      keyspace: ref.keyspace,
    })
  })

  it('record the owner on every piece, without it affecting the key', () => {
    const owned = pieceMetadata(ref, { salt: newSalt(), scope: 'agent-memory' })
    const kk = new Uint8Array(32).fill(7)
    assert.equal(owned['foc/own'], account.address.toLowerCase(), 'the keyspace owner, lowercased')
    const relabelled = { ...owned, 'foc/own': '0x0000000000000000000000000000000000000000' as const }
    assert.deepStrictEqual(keyForEnvelope(kk, relabelled), keyForEnvelope(kk, owned), 'derivation ignores it')
  })

  it('refuse a keyspace id that is not 16 bytes of hex', () => {
    assert.equal(keyspaceId('0x00112233445566778899AABBCCDDEEFF'), ref.keyspace)
    assert.throws(() => keyspaceId('0x2a'), /16 bytes/)
    assert.throws(() => pieceMetadata({ ...ref, keyspace: '0x2a' }, { salt: newSalt() }), /16 bytes/)
  })

  it('mint distinct salts and keyspaces', () => {
    assert.notEqual(newSalt(), newSalt())
    assert.notEqual(newKeyspace(), newKeyspace())
    assert.equal(hexToBytes(newKeyspace()).length, 16)
  })
})

describe('scope tree', () => {
  it('lets a scope open every scope beneath it, and nothing above or beside it', async () => {
    const kk = await kkOf(account, ref)
    const deep = pieceMetadata(ref, { salt: newSalt(), scope: 'super-secret/secret/internal' })
    const expected = keyForEnvelope(kk, deep)
    assert.deepStrictEqual(keyForEnvelope(scopeKey(kk, 'super-secret'), deep, { scope: 'super-secret' }), expected)
    assert.deepStrictEqual(
      keyForEnvelope(scopeKey(kk, 'super-secret/secret'), deep, { scope: 'super-secret/secret' }),
      expected
    )

    const upper = pieceMetadata(ref, { salt: newSalt(), scope: 'super-secret' })
    assert.throws(
      () => keyForEnvelope(scopeKey(kk, 'super-secret/secret'), upper, { scope: 'super-secret/secret' }),
      /does not contain/
    )
    const sibling = pieceMetadata(ref, { salt: newSalt(), scope: 'super-secret/finance' })
    assert.throws(
      () => keyForEnvelope(scopeKey(kk, 'super-secret/secret'), sibling, { scope: 'super-secret/secret' }),
      /does not contain/
    )
  })

  it('gives siblings unrelated keys: neither opens the other', async () => {
    const kk = await kkOf(account, ref)
    const salt = newSalt()
    assert.notDeepStrictEqual(scopeKey(kk, 'super-secret'), scopeKey(kk, 'secret'))
    assert.notDeepStrictEqual(pieceKey(scopeKey(kk, 'super-secret'), salt), pieceKey(scopeKey(kk, 'secret'), salt))
  })

  it('derives a child from its parent, so position is part of the key', async () => {
    const kk = await kkOf(account, ref)
    assert.notDeepStrictEqual(
      scopeKey(kk, 'secret'),
      scopeKey(kk, 'super-secret/secret'),
      'same name, different parent'
    )
    assert.notDeepStrictEqual(scopeKey(kk, 'a/b'), scopeKey(kk, 'b/a'))
  })

  it('canonicalises paths, and refuses empty segments and stray slashes', () => {
    assert.equal(scopePath('Super/cafe\u0301'), 'Super/caf\u00e9')
    assert.throws(() => scopePath('super-secret//secret'), /non-empty/)
    assert.throws(() => scopePath('/super-secret'), /non-empty/)
    assert.throws(() => scopeName('a/b'), /no "\/"/)
    assert.deepStrictEqual(holdingOf({ node: 'scope:super-secret/cafe\u0301' }), { scope: 'super-secret/caf\u00e9' })
  })
})

describe('writeTarget', () => {
  it('lets a scope grant write under its own scope, or beneath it, and nowhere else', async () => {
    const kk = await kkOf(account, ref)
    const grant = grantDescriptor(ref, 'scope:admin/finance')
    const rk = scopeKey(kk, 'admin/finance')

    const own = writeTarget(grant, rk)
    assert.equal(own.scope, 'admin/finance', 'defaults to the grant’s own scope')
    assert.deepStrictEqual(own.key, rk)
    assert.deepStrictEqual(own.ref, { owner: grant.owner, keyspace: ref.keyspace })

    const deeper = writeTarget(grant, rk, 'admin/finance/clerks')
    const salt = newSalt()
    const metadata = pieceMetadata(deeper.ref, { salt, scope: deeper.scope })
    assert.deepStrictEqual(
      pieceKey(deeper.key, salt),
      keyForEnvelope(kk, metadata),
      'the owner can read what the delegate wrote'
    )

    assert.throws(() => writeTarget(grant, rk, 'admin'), /cannot write under "admin"/)
    assert.throws(() => writeTarget(grant, rk, 'admin/legal'), /cannot write under/)
  })

  it('lets a keyspace grant write under any scope, or none', async () => {
    const kk = await kkOf(account, ref)
    const grant = grantDescriptor(ref, 'keyspace')
    assert.equal(writeTarget(grant, kk).scope, undefined)
    assert.deepStrictEqual(writeTarget(grant, kk).key, kk)
    assert.deepStrictEqual(writeTarget(grant, kk, 'agent-memory').key, scopeKey(kk, 'agent-memory'))
  })
})

describe('commitment', () => {
  it('matches only the owner’s key for that keyspace', async () => {
    const { kk, commitment: c } = await keyspaceKeys(account, ref)
    assert.ok(matchesCommitment(kk, c))
    assert.ok(!matchesCommitment(await kkOf(account, { ...ref, keyspace: newKeyspace() }), c), 'another keyspace')
    const other = privateKeyToAccount(generatePrivateKey())
    assert.ok(!matchesCommitment(await kkOf(other, { ...ref, owner: other.address }), c), 'another wallet')
  })

  it('refuses a value in any other format, including the earlier v1.<epoch>.<hex>', async () => {
    const kk = await kkOf(account, ref)
    for (const bad of ['v2.0123456789abcdef0123456789abcdef', 'v1.0123', 'v1.0.0123456789abcdef0123456789abcdef']) {
      assert.throws(() => matchesCommitment(kk, bad), /format v1/, bad)
    }
  })
})

describe('piece grants', () => {
  it('name one piece by its salt, in canonical form', () => {
    const salt = '0x00ABCDEF0123456789ABCDEF01234567'
    assert.equal(grantDescriptor(ref, `piece:${salt}`).node, `piece:${salt.toLowerCase()}`)
    assert.deepStrictEqual(holdingOf({ node: `piece:${salt}` }), { piece: salt.toLowerCase() })
    assert.throws(() => holdingOf({ node: 'piece:0xabc' }), /hex bytes/)
    assert.throws(() => holdingOf({ node: 'piece:' }), /hex bytes/)
  })

  it('return the piece key for that piece only', async () => {
    const kk = await kkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), scope: 'super-secret' })
    const pk = keyForEnvelope(kk, metadata)
    assert.equal(pieceNode(metadata), `piece:${metadata['foc/salt']}`)
    assert.equal(
      pieceNode({ 'foc/salt': '0x00ABCDEF0123456789ABCDEF01234567' }),
      'piece:0x00abcdef0123456789abcdef01234567'
    )
    const holding = holdingOf(grantDescriptor(ref, pieceNode(metadata)))
    assert.deepStrictEqual(keyForEnvelope(pk, metadata, holding), pk)
    const neighbour = pieceMetadata(ref, { salt: newSalt(), scope: 'super-secret' })
    assert.throws(() => keyForEnvelope(pk, neighbour, holding), /another piece/)
  })

  it('cannot write: a piece key belongs to one existing piece', async () => {
    const kk = await kkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt() })
    const grant = grantDescriptor(ref, `piece:${metadata['foc/salt']}`)
    assert.throws(() => writeTarget(grant, keyForEnvelope(kk, metadata)), /cannot write/)
  })
})
