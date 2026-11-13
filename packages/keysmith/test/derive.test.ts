import { secp256k1 } from '@noble/curves/secp256k1.js'
import assert from 'assert'
import { bytesToHex, hashDomain, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  canonicalNode,
  commitment,
  DOMAIN,
  deriveGroupKey,
  GROUP_KEY_ID_KEY,
  grantDescriptor,
  groupKeyId,
  groupKeyIdOf,
  groupKeyMessage,
  groupName,
  groupPath,
  holdingOf,
  keyForEnvelope,
  keyForGroup,
  LEGACY_GROUP_KEY_ID_KEY,
  lowSrs,
  matchesCommitment,
  newGroupKeyId,
  newNode,
  newSalt,
  nodeKind,
  pieceKey,
  pieceMetadata,
  pieceNode,
  readPieceMetadata,
  writeTarget,
} from '../src/derive.ts'
import type { GroupKeyRef, PieceMetadataV1, TypedDataSigner } from '../src/types.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: GroupKeyRef = { owner: account.address, groupKeyId: '0x00112233445566778899aabbccddeeff' }
const kkOf = async (signer: TypedDataSigner, r: GroupKeyRef) => (await deriveGroupKey(signer, r)).kk

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

describe('groupKeyMessage', () => {
  it('names the owner and group key, and signs nothing about chains or datasets', () => {
    const message = groupKeyMessage(ref)
    assert.equal(message.keyspace, ref.groupKeyId)
    assert.deepStrictEqual(Object.keys(message).sort(), ['keyspace', 'owner'])
  })
})

describe('deriveGroupKey', () => {
  it('derives the same key for the same wallet and group key id', async () => {
    assert.deepStrictEqual(await kkOf(account, ref), await kkOf(account, ref))
  })

  it('derives an unrelated key for another group key, or another wallet', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    assert.notDeepStrictEqual(await kkOf(account, ref), await kkOf(account, { ...ref, groupKeyId: newGroupKeyId() }))
    assert.notDeepStrictEqual(await kkOf(account, ref), await kkOf(other, { ...ref, owner: other.address }))
  })

  it('accepts the group key in any case, since it is canonicalised before signing', async () => {
    const upper = ref.groupKeyId.toUpperCase().replace('0X', '0x') as `0x${string}`
    assert.deepStrictEqual(await kkOf(account, ref), await kkOf(account, { ...ref, groupKeyId: upper }))
  })

  it('returns a commitment derived from the group key, so any key holder can recompute it', async () => {
    const { kk, commitment: c } = await deriveGroupKey(account, ref)
    assert.equal(c, commitment(kk))
    assert.match(c, /^v1\.[0-9a-f]{32}$/)
    assert.notEqual(c, (await deriveGroupKey(account, { ...ref, groupKeyId: newGroupKeyId() })).commitment)
    assert.ok(!c.includes(bytesToHex(kk).slice(2, 34)), 'the commitment must not contain the key')
  })

  it('refuses a signature from any wallet but the owner’s, a session key included', async () => {
    const session = privateKeyToAccount(generatePrivateKey())
    await assert.rejects(deriveGroupKey(session, ref), /not from the group key owner/)
    const ownerInOtherCase = { ...ref, owner: account.address.toLowerCase() as `0x${string}` }
    await deriveGroupKey(account, ownerInOtherCase)
  })

  it('returns the group key descriptor, so an owner writes the way a delegate does', async () => {
    const { kk, descriptor } = await deriveGroupKey(account, ref)
    assert.deepStrictEqual(descriptor, grantDescriptor(ref, 'groupKey'))
    const target = writeTarget(descriptor, kk, 'agent-memory')
    const salt = newSalt()
    const metadata = pieceMetadata(target.ref, { salt, group: target.group })
    assert.equal(metadata['foc/gkid'], ref.groupKeyId, 'the group key comes from what was signed')
    assert.deepStrictEqual(pieceKey(target.key, salt), keyForEnvelope(kk, metadata))
  })

  it('signs twice for a new group key, and once for one with a recorded commitment', async () => {
    const signer = counting(account)
    const { kk, commitment: kc } = await deriveGroupKey(signer, ref)
    assert.equal(signer.calls, 2, 'new group key: sign, sign again, compare')
    await deriveGroupKey(signer, ref)
    assert.equal(signer.calls, 4, 'nothing is remembered between calls')
    const reopened = await deriveGroupKey(signer, ref, { commitment: kc })
    assert.equal(signer.calls, 5, 'existing group key: the commitment does the checking')
    assert.deepStrictEqual(reopened.kk, kk)
    await deriveGroupKey(signer, ref, { commitment: kc, verifySigner: true })
    assert.equal(signer.calls, 7, 'checking can be forced')
    await deriveGroupKey(signer, ref, { verifySigner: false })
    assert.equal(signer.calls, 8, 'or skipped for a signer already vetted')
  })

  it('refuses a key that does not match the recorded commitment', async () => {
    const other = await deriveGroupKey(account, { ...ref, groupKeyId: newGroupKeyId() })
    await assert.rejects(
      deriveGroupKey(account, ref, { commitment: other.commitment }),
      /does not match the recorded commitment/
    )
    await assert.rejects(deriveGroupKey(account, ref, { commitment: 'v1.0.00' }), /format v1/)
  })

  describe('with a password', function () {
    // Each Argon2id pass is 64 MiB and about a second, slower in a browser
    this.timeout(30_000)
    let locked: Awaited<ReturnType<typeof deriveGroupKey>>

    before(async () => {
      locked = await deriveGroupKey(account, ref, { password: 'caf\u00e9' })
    })

    it('derives a different key than without one', async () => {
      assert.notEqual(bytesToHex(locked.kk), bytesToHex((await deriveGroupKey(account, ref)).kk))
    })

    it('reopens with the same password in any Unicode normal form', async () => {
      const again = await deriveGroupKey(account, ref, { password: 'cafe\u0301', commitment: locked.commitment })
      assert.equal(bytesToHex(again.kk), bytesToHex(locked.kk))
    })

    it('refuses a wrong password, or a missing one, against the commitment', async () => {
      await assert.rejects(
        deriveGroupKey(account, ref, { password: 'cafe', commitment: locked.commitment }),
        /the password is wrong/
      )
      await assert.rejects(deriveGroupKey(account, ref, { commitment: locked.commitment }), /may need a password/)
    })

    it('refuses a bad password or commitment before the wallet prompts', async () => {
      const signer = counting(account)
      await assert.rejects(deriveGroupKey(signer, ref, { password: '' }), /non-empty/)
      await assert.rejects(deriveGroupKey(signer, ref, { password: '\ud800' }), /well-formed/)
      await assert.rejects(deriveGroupKey(signer, ref, { password: 'x', commitment: 'v1.0.00' }), /format v1/)
      assert.equal(signer.calls, 0)
    })
  })

  it('rejects a randomising signer, and anything that is not plain ECDSA', async () => {
    let calls = 0
    const r = bytesToHex(new Uint8Array(32).fill(1))
    const flaky: TypedDataSigner = {
      signTypedData: async () => `${r}${(++calls).toString(16).padStart(64, '0')}1b` as const,
    }
    await assert.rejects(deriveGroupKey(flaky, ref), /not deterministic/)
    const abiLike: TypedDataSigner = {
      signTypedData: async () => `0x${'20'.padStart(64, '0')}${'41'.padStart(64, '0')}${'ab'.repeat(65)}` as const,
    }
    await assert.rejects(deriveGroupKey(abiLike, ref), /64- or 65-byte/)
  })
})

describe('lowSrs', () => {
  const r = bytesToHex(new Uint8Array(32).fill(0xab))
  const asSig = (s: bigint, v = '1b') => `${r}${s.toString(16).padStart(64, '0')}${v}` as `0x${string}`

  it('drops v and normalises a high-S signature to the low form', () => {
    const low = 0x0123456789abcdefn
    assert.deepStrictEqual(lowSrs(asSig(low, '1b')), lowSrs(asSig(secp256k1.Point.CURVE().n - low, '1c')))
    assert.deepStrictEqual(lowSrs(asSig(7n, '')), lowSrs(asSig(7n)), '64-byte r‖s with no v is fine')
  })

  it('rejects other lengths, and r or s outside [1, n−1]', () => {
    assert.throws(() => lowSrs('0xdeadbeef'), /64- or 65-byte/)
    assert.throws(() => lowSrs(`${asSig(7n)}00`), /64- or 65-byte/)
    assert.throws(() => lowSrs(asSig(0n)), /\[1, n−1\]/)
    assert.throws(() => lowSrs(asSig(secp256k1.Point.CURVE().n)), /\[1, n−1\]/)
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
    assert.throws(() => keyForEnvelope(kk, prototype), /format 1 with a group key/, 'a pre-release prototype')
    const future = { ...pieceMetadata(ref, { salt: newSalt() }), 'foc/v': 3 } as never
    assert.throws(() => keyForEnvelope(kk, future), /not format 1 or 2.*reads formats 1 and 2/)
  })

  it('refuses malformed envelope metadata clearly, rather than deriving from it', () => {
    const kk = new Uint8Array(32).fill(7)
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'a/b' })
    assert.throws(() => keyForEnvelope(kk, null as never), /envelope metadata must be an object/)
    const hostile = [
      [{ 'foc/salt': 'hello' }, /piece salt is hex bytes/],
      [{ 'foc/salt': '0x' }, /piece salt is hex bytes/],
      [{ 'foc/salt': 5 }, /piece salt must be a string/],
      [{ 'foc/salt': undefined }, /piece salt must be a string/],
      [{ 'foc/group': 5 }, /group path must be a string/],
      [{ 'foc/gkid': '0xzz' }, /group key id is 16 bytes/],
    ] as const
    for (const [fields, error] of hostile) {
      assert.throws(() => keyForEnvelope(kk, { ...metadata, ...fields } as never), error, JSON.stringify(fields))
    }
    assert.throws(() => keyForEnvelope(kk, metadata, { group: 5 } as never), /group path must be a string/)
  })

  it('given the grant, refuses a piece from another group key or owner with a clear reason', async () => {
    const kk = await kkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'team/notes' })
    const grant = grantDescriptor(ref, 'group:team')
    const rk = keyForGroup(kk, 'team')
    assert.deepStrictEqual(keyForEnvelope(rk, metadata, grant), keyForEnvelope(rk, metadata, holdingOf(grant)))
    const otherGroupKey = grantDescriptor({ ...ref, groupKeyId: newGroupKeyId() }, 'group:team')
    assert.throws(() => keyForEnvelope(rk, metadata, otherGroupKey), /This key is for group key 0x.*; the piece is in/)
    const otherOwner = grantDescriptor(
      { ...ref, owner: privateKeyToAccount(generatePrivateKey()).address },
      'group:team'
    )
    assert.throws(() => keyForEnvelope(rk, metadata, otherOwner), /This key is from owner/)
  })

  it('writes only a 16-byte hex salt', () => {
    assert.throws(() => pieceMetadata(ref, { salt: 'hello' as never }), /piece salt is hex bytes/)
    assert.throws(() => pieceMetadata(ref, { salt: '0x2a' }), /16 random bytes/)
    assert.throws(() => pieceKey(new Uint8Array(32), 'hello' as never), /piece salt is hex bytes/)
  })
})

describe('groups', () => {
  it('give a group key holder and a group holder the same piece key', async () => {
    const kk = await kkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'agent-memory' })
    assert.deepStrictEqual(
      keyForEnvelope(kk, metadata),
      keyForEnvelope(keyForGroup(kk, 'agent-memory'), metadata, { group: 'agent-memory' })
    )
  })

  it('say so when a group key is used on a piece with no group', async () => {
    const kk = await kkOf(account, ref)
    const unlabelled = pieceMetadata(ref, { salt: newSalt() })
    assert.throws(
      () => keyForEnvelope(keyForGroup(kk, 'agent-memory'), unlabelled, { group: 'agent-memory' }),
      /does not contain/
    )
  })

  it('are canonicalised: NFC, case kept, no padding', async () => {
    const kk = await kkOf(account, ref)
    assert.deepStrictEqual(keyForGroup(kk, 'café'), keyForGroup(kk, 'café'))
    assert.notDeepStrictEqual(keyForGroup(kk, 'Finance'), keyForGroup(kk, 'finance'))
    assert.equal(groupName('café'), 'café')
    assert.throws(() => keyForGroup(kk, ''), /non-empty/)
    assert.throws(() => pieceMetadata(ref, { salt: newSalt(), group: 'secret ' }), /whitespace/)
  })
})

describe('holdingOf', () => {
  it('reads the level back off a grant, and refuses what it does not understand', () => {
    assert.equal(holdingOf({ node: 'groupKey' }), 'groupKey')
    assert.equal(holdingOf({ node: 'keyspace' }), 'groupKey', 'legacy spelling')
    assert.deepStrictEqual(holdingOf({ node: 'group:agent-memory' }), { group: 'agent-memory' })
    assert.deepStrictEqual(holdingOf({ node: 'scope:agent-memory' }), { group: 'agent-memory' }, 'legacy spelling')
    assert.throws(() => holdingOf({ node: 'dataset' }), /Unrecognised grant node/)
    assert.throws(() => holdingOf({ node: 'role:invoices' }), /Unrecognised grant node/)
  })
})

describe('pieceMetadata and grantDescriptor', () => {
  it('record what a reader needs, in canonical form, and nothing secret', () => {
    const salt = '0x00CDEF0123456789ABCDEF0123456789' as const
    assert.deepStrictEqual(pieceMetadata(ref, { salt, group: 'café' }), {
      'foc/v': 2,
      'foc/own': account.address.toLowerCase(),
      'foc/gkid': ref.groupKeyId,
      'foc/group': 'café',
      'foc/salt': '0x00cdef0123456789abcdef0123456789',
    })
    assert.deepStrictEqual(grantDescriptor(ref, 'scope:café'), {
      v: 1,
      node: 'group:café',
      owner: account.address.toLowerCase(),
      groupKeyId: ref.groupKeyId,
    })
  })

  it('record the owner on every piece, without it affecting the key', () => {
    const owned = pieceMetadata(ref, { salt: newSalt(), group: 'agent-memory' })
    const kk = new Uint8Array(32).fill(7)
    assert.equal(owned['foc/own'], account.address.toLowerCase(), 'the group key owner, lowercased')
    const relabelled = { ...owned, 'foc/own': '0x0000000000000000000000000000000000000000' as const }
    assert.deepStrictEqual(keyForEnvelope(kk, relabelled), keyForEnvelope(kk, owned), 'derivation ignores it')
  })

  it('refuse a group key id that is not 16 bytes of hex', () => {
    assert.equal(groupKeyId('0x00112233445566778899AABBCCDDEEFF'), ref.groupKeyId)
    assert.throws(() => groupKeyId('0x2a'), /16 bytes/)
    assert.throws(() => pieceMetadata({ ...ref, groupKeyId: '0x2a' }, { salt: newSalt() }), /16 bytes/)
  })

  it('mint distinct salts and group keys', () => {
    assert.notEqual(newSalt(), newSalt())
    assert.notEqual(newGroupKeyId(), newGroupKeyId())
    assert.equal(hexToBytes(newGroupKeyId()).length, 16)
  })
})

describe('group tree', () => {
  it('lets a group open every group beneath it, and nothing above or beside it', async () => {
    const kk = await kkOf(account, ref)
    const deep = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret/secret/internal' })
    const expected = keyForEnvelope(kk, deep)
    assert.deepStrictEqual(keyForEnvelope(keyForGroup(kk, 'super-secret'), deep, { group: 'super-secret' }), expected)
    assert.deepStrictEqual(
      keyForEnvelope(keyForGroup(kk, 'super-secret/secret'), deep, { group: 'super-secret/secret' }),
      expected
    )

    const upper = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret' })
    assert.throws(
      () => keyForEnvelope(keyForGroup(kk, 'super-secret/secret'), upper, { group: 'super-secret/secret' }),
      /does not contain/
    )
    const sibling = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret/finance' })
    assert.throws(
      () => keyForEnvelope(keyForGroup(kk, 'super-secret/secret'), sibling, { group: 'super-secret/secret' }),
      /does not contain/
    )
  })

  it('gives siblings unrelated keys: neither opens the other', async () => {
    const kk = await kkOf(account, ref)
    const salt = newSalt()
    assert.notDeepStrictEqual(keyForGroup(kk, 'super-secret'), keyForGroup(kk, 'secret'))
    assert.notDeepStrictEqual(
      pieceKey(keyForGroup(kk, 'super-secret'), salt),
      pieceKey(keyForGroup(kk, 'secret'), salt)
    )
  })

  it('derives a child from its parent, so position is part of the key', async () => {
    const kk = await kkOf(account, ref)
    assert.notDeepStrictEqual(
      keyForGroup(kk, 'secret'),
      keyForGroup(kk, 'super-secret/secret'),
      'same name, different parent'
    )
    assert.notDeepStrictEqual(keyForGroup(kk, 'a/b'), keyForGroup(kk, 'b/a'))
  })

  it('canonicalises paths, and refuses empty segments and stray slashes', () => {
    assert.equal(groupPath('Super/cafe\u0301'), 'Super/caf\u00e9')
    assert.throws(() => groupPath('super-secret//secret'), /non-empty/)
    assert.throws(() => groupPath('/super-secret'), /non-empty/)
    assert.throws(() => groupName('a/b'), /no "\/"/)
    assert.deepStrictEqual(holdingOf({ node: 'scope:super-secret/cafe\u0301' }), { group: 'super-secret/caf\u00e9' })
  })

  it('refuses lone surrogates, which would derive the same key as U+FFFD', () => {
    // team/\ud800 and team/\ufffd encode to the same UTF-8, so they must not both be groups.
    assert.throws(() => groupPath('team/\ud800'), /well-formed/)
    assert.throws(() => groupName('x\udc00'), /well-formed/)
    assert.throws(() => holdingOf({ node: 'scope:team/\ud800' }), /well-formed/)
    assert.equal(groupPath('team/\ufffd'), 'team/\ufffd')
    assert.equal(groupName('key-\u{1F511}'), 'key-\u{1F511}') // a properly paired surrogate is fine
  })
})

describe('writeTarget', () => {
  it('lets a group grant write under its own group, or beneath it, and nowhere else', async () => {
    const kk = await kkOf(account, ref)
    const grant = grantDescriptor(ref, 'group:admin/finance')
    const rk = keyForGroup(kk, 'admin/finance')

    const own = writeTarget(grant, rk)
    assert.equal(own.group, 'admin/finance', 'defaults to the grant’s own group')
    assert.deepStrictEqual(own.key, rk)
    assert.deepStrictEqual(own.ref, { owner: grant.owner, groupKeyId: ref.groupKeyId })

    const deeper = writeTarget(grant, rk, 'admin/finance/clerks')
    const salt = newSalt()
    const metadata = pieceMetadata(deeper.ref, { salt, group: deeper.group })
    assert.deepStrictEqual(
      pieceKey(deeper.key, salt),
      keyForEnvelope(kk, metadata),
      'the owner can read what the delegate wrote'
    )

    assert.throws(() => writeTarget(grant, rk, 'admin'), /cannot write under "admin"/)
    assert.throws(() => writeTarget(grant, rk, 'admin/legal'), /cannot write under/)
  })

  it('lets a group key grant write under any group, or none', async () => {
    const kk = await kkOf(account, ref)
    const grant = grantDescriptor(ref, 'groupKey')
    assert.equal(writeTarget(grant, kk).group, undefined)
    assert.deepStrictEqual(writeTarget(grant, kk).key, kk)
    assert.deepStrictEqual(writeTarget(grant, kk, 'agent-memory').key, keyForGroup(kk, 'agent-memory'))
  })
})

describe('commitment', () => {
  it('matches only the owner’s key for that group key id', async () => {
    const { kk, commitment: c } = await deriveGroupKey(account, ref)
    assert.ok(matchesCommitment(kk, c))
    assert.ok(
      !matchesCommitment(await kkOf(account, { ...ref, groupKeyId: newGroupKeyId() }), c),
      'another group key id'
    )
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
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret' })
    const pk = keyForEnvelope(kk, metadata)
    assert.equal(pieceNode(metadata), `piece:${metadata['foc/salt']}`)
    assert.equal(
      pieceNode({ ...metadata, 'foc/salt': '0x00ABCDEF0123456789ABCDEF01234567' }),
      'piece:0x00abcdef0123456789abcdef01234567'
    )
    const holding = holdingOf(grantDescriptor(ref, pieceNode(metadata)))
    assert.deepStrictEqual(keyForEnvelope(pk, metadata, holding), pk)
    const neighbour = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret' })
    assert.throws(() => keyForEnvelope(pk, neighbour, holding), /another piece/)
  })

  it('cannot write: a piece key belongs to one existing piece', async () => {
    const kk = await kkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt() })
    const grant = grantDescriptor(ref, `piece:${metadata['foc/salt']}`)
    assert.throws(() => writeTarget(grant, keyForEnvelope(kk, metadata)), /cannot write/)
  })
})

describe('canonicalNode', () => {
  it('refuses a piece node that does not name a 16-byte salt', () => {
    assert.throws(() => canonicalNode('piece:0xab'), /16-byte salt/)
  })
})

describe('refuses stale option names', () => {
  const salt = newSalt()

  it('refuses a `scope` option rather than dropping it', () => {
    const stale = { salt, scope: 'agent-memory' } // not a fresh literal, so TypeScript cannot catch it
    assert.throws(() => pieceMetadata(ref, stale), /takes `group`, not `scope`/)
    const maybe = Math.random() < 2 ? 'x' : undefined // a conditional spread: TypeScript accepts this
    assert.throws(() => pieceMetadata(ref, { salt, ...(maybe && { scope: maybe }) }), /takes `group`, not `scope`/)
  })
})

describe('format 2 and the legacy names', () => {
  const salt = '0x000102030405060708090a0b0c0d0e0f' as const
  const v2 = pieceMetadata(ref, { salt, group: 'admin/finance' })
  const v1: PieceMetadataV1 = {
    'foc/v': 1,
    'foc/own': v2['foc/own'],
    'foc/ks': ref.groupKeyId,
    'foc/scope': 'admin/finance',
    'foc/salt': salt,
  }

  it('writes format 2, and reads both formats as the same labels', () => {
    assert.deepStrictEqual(Object.keys(v2).sort(), ['foc/gkid', 'foc/group', 'foc/own', 'foc/salt', 'foc/v'])
    const { version: a, ...r1 } = readPieceMetadata(v1)
    const { version: b, ...r2 } = readPieceMetadata(v2)
    assert.deepStrictEqual([a, b], [1, 2])
    assert.deepStrictEqual(r1, r2)
    assert.deepStrictEqual(r1, { owner: v2['foc/own'], groupKeyId: ref.groupKeyId, group: 'admin/finance', salt })
    assert.equal(readPieceMetadata({ ...v2, 'foc/group': undefined }).group, undefined)
  })

  it('keeps each format strict, and names the versions it reads', () => {
    assert.throws(() => readPieceMetadata({ ...v2, 'foc/ks': ref.groupKeyId }), /format 2.*must not carry foc\/ks/)
    assert.throws(
      () => readPieceMetadata({ ...v2, 'foc/scope': 'a' }),
      /format 2.*must not carry foc\/ks or foc\/scope/
    )
    assert.throws(() => readPieceMetadata({ ...v1, 'foc/gkid': ref.groupKeyId }), /format 1.*must not carry foc\/gkid/)
    assert.throws(
      () => readPieceMetadata({ ...v1, 'foc/group': 'a' }),
      /format 1.*must not carry foc\/gkid or foc\/group/
    )
    assert.throws(() => readPieceMetadata({ ...v1, 'foc/v': 2 }), /not format 2 with a group key/)
    assert.throws(() => readPieceMetadata({ ...v2, 'foc/v': 3 }), /not format 1 or 2.*reads formats 1 and 2/)
    assert.throws(() => readPieceMetadata({ ...v2, 'foc/v': undefined }), /reads formats 1 and 2/)
    assert.throws(() => readPieceMetadata(undefined), /must be an object/)
  })

  it('never lets a label name or node prefix change a key', async () => {
    const kk = await kkOf(account, ref)
    const rk = keyForGroup(kk, 'admin/finance')
    const want = keyForEnvelope(kk, v1)
    assert.deepStrictEqual(keyForEnvelope(kk, v2), want)
    assert.deepStrictEqual(keyForEnvelope(rk, v1, { group: 'admin/finance' }), want)
    assert.deepStrictEqual(keyForEnvelope(rk, v2, { group: 'admin/finance' }), want)
    // a grant node in either spelling holds the same thing, so derives the same key
    for (const [legacy, current] of [
      ['scope:admin/finance', 'group:admin/finance'],
      ['scope:admin', 'group:admin'],
      ['keyspace', 'groupKey'],
    ] as const) {
      const held = legacy === 'keyspace' ? kk : keyForGroup(kk, legacy.slice('scope:'.length))
      const old = { ...grantDescriptor(ref, current), node: legacy }
      assert.deepStrictEqual(holdingOf(old), holdingOf({ node: current }))
      assert.deepStrictEqual(keyForEnvelope(held, v1, old), keyForEnvelope(held, v2, grantDescriptor(ref, current)))
      assert.deepStrictEqual(keyForEnvelope(held, v2, old), want)
    }
    assert.deepStrictEqual(pieceNode(v1), pieceNode(v2))
  })

  it('writes the current node spelling for new things, and keeps a received one', () => {
    assert.equal(grantDescriptor(ref, 'keyspace').node, 'groupKey')
    assert.equal(grantDescriptor(ref, 'scope:a/b').node, 'group:a/b')
    assert.equal(newNode('scope:cafe\u0301'), 'group:caf\u00e9')
    assert.equal(canonicalNode('keyspace'), 'keyspace')
    assert.equal(canonicalNode('scope:cafe\u0301'), 'scope:caf\u00e9')
    assert.equal(canonicalNode('group:cafe\u0301'), 'group:caf\u00e9')
    assert.deepStrictEqual(nodeKind('scope:a/b'), nodeKind('group:a/b'))
    assert.deepStrictEqual(nodeKind('keyspace'), nodeKind('groupKey'))
    assert.throws(() => nodeKind('group:a/'), /A group name must be non-empty/)
    assert.throws(() => nodeKind('scope:a/'), /A scope name must be non-empty/) // pinned by claims-vectors.json
    assert.throws(() => nodeKind('groupKey:x'), /Unrecognised grant node/)
  })

  it('finds the group key on a data set under either key, and refuses a conflict', () => {
    const id = ref.groupKeyId
    const upper = id.toUpperCase().replace('0X', '0x')
    assert.equal(GROUP_KEY_ID_KEY, 'foc/gkid')
    assert.equal(LEGACY_GROUP_KEY_ID_KEY, 'foc/ks')
    assert.equal(groupKeyIdOf({ [GROUP_KEY_ID_KEY]: id }), id)
    assert.equal(groupKeyIdOf({ [LEGACY_GROUP_KEY_ID_KEY]: upper }), id)
    assert.equal(groupKeyIdOf({ [GROUP_KEY_ID_KEY]: id, [LEGACY_GROUP_KEY_ID_KEY]: upper }), id)
    assert.equal(groupKeyIdOf({ 'foc/kc': 'v1.00' }), undefined)
    assert.throws(
      () => groupKeyIdOf({ [GROUP_KEY_ID_KEY]: id, [LEGACY_GROUP_KEY_ID_KEY]: newGroupKeyId() }),
      /two different group keys/
    )
    assert.throws(() => groupKeyIdOf({ [GROUP_KEY_ID_KEY]: 'nope' }), /group key id is 16 bytes/)
  })
})
