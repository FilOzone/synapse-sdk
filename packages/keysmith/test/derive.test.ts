import { secp256k1 } from '@noble/curves/secp256k1.js'
import assert from 'assert'
import { bytesToHex, type Hex, hashDomain, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  COMMITMENT_KEY,
  canonicalNode,
  commitment,
  DOMAIN,
  dataSetMetadata,
  deriveGroupKey,
  grantDescriptor,
  groupKeyId,
  groupKeyIdOf,
  groupKeyMessage,
  groupLabelOf,
  groupName,
  groupPath,
  holdingOf,
  keyForEnvelope,
  keyForGroup,
  labelsGroupKeyId,
  lowSrs,
  matchesCommitment,
  newGroupKeyId,
  newSalt,
  nodeKind,
  pieceKey,
  pieceMetadata,
  pieceNode,
  readPieceMetadata,
  writeTarget,
} from '../src/derive.ts'
import type { GrantDescriptor, GroupKeyRef, TypedDataSigner } from '../src/types.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: GroupKeyRef = { owner: account.address, groupKeyId: '0x00112233445566778899aabbccddeeff' }
const groupKeyOf = async (signer: TypedDataSigner, r: GroupKeyRef) => (await deriveGroupKey(signer, r)).groupKey

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
    assert.equal(message.groupKeyId, ref.groupKeyId)
    assert.deepStrictEqual(Object.keys(message).sort(), ['groupKeyId', 'owner'])
  })
})

describe('deriveGroupKey', () => {
  it('derives the same key for the same wallet and group key id', async () => {
    assert.deepStrictEqual(await groupKeyOf(account, ref), await groupKeyOf(account, ref))
  })

  it('derives an unrelated key for another group key, or another wallet', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    assert.notDeepStrictEqual(
      await groupKeyOf(account, ref),
      await groupKeyOf(account, { ...ref, groupKeyId: newGroupKeyId() })
    )
    assert.notDeepStrictEqual(await groupKeyOf(account, ref), await groupKeyOf(other, { ...ref, owner: other.address }))
  })

  it('accepts the group key in any case, since it is canonicalised before signing', async () => {
    const upper = ref.groupKeyId.toUpperCase().replace('0X', '0x') as `0x${string}`
    assert.deepStrictEqual(await groupKeyOf(account, ref), await groupKeyOf(account, { ...ref, groupKeyId: upper }))
  })

  it('returns a commitment derived from the group key, so any key holder can recompute it', async () => {
    const { groupKey, commitment: c } = await deriveGroupKey(account, ref)
    assert.equal(c, commitment(groupKey))
    assert.match(c, /^v2\.[0-9a-f]{32}$/)
    assert.notEqual(c, (await deriveGroupKey(account, { ...ref, groupKeyId: newGroupKeyId() })).commitment)
    assert.ok(!c.includes(bytesToHex(groupKey).slice(2, 34)), 'the commitment must not contain the key')
  })

  it('refuses a signature from any wallet but the owner’s, a session key included', async () => {
    const session = privateKeyToAccount(generatePrivateKey())
    await assert.rejects(deriveGroupKey(session, ref), /not from the group key owner/)
    const ownerInOtherCase = { ...ref, owner: account.address.toLowerCase() as `0x${string}` }
    await deriveGroupKey(account, ownerInOtherCase)
  })

  it('returns the group key descriptor, so an owner writes the way a delegate does', async () => {
    const { groupKey, descriptor } = await deriveGroupKey(account, ref)
    assert.deepStrictEqual(descriptor, grantDescriptor(ref, 'groupKey'))
    assert.equal(descriptor.node, 'groupKey')
    const target = writeTarget(descriptor, groupKey, 'agent-memory')
    const salt = newSalt()
    const metadata = pieceMetadata(target.ref, { salt, group: target.group })
    assert.equal(metadata['foc/gkid'], ref.groupKeyId, 'the group key comes from what was signed')
    assert.deepStrictEqual(pieceKey(target.key, salt), keyForEnvelope(groupKey, metadata))
  })

  it('signs twice for a new group key, and once for one with a recorded commitment', async () => {
    const signer = counting(account)
    const { groupKey, commitment: kc } = await deriveGroupKey(signer, ref)
    assert.equal(signer.calls, 2, 'new group key: sign, sign again, compare')
    await deriveGroupKey(signer, ref)
    assert.equal(signer.calls, 4, 'nothing is remembered between calls')
    const reopened = await deriveGroupKey(signer, ref, { commitment: kc })
    assert.equal(signer.calls, 5, 'existing group key: the commitment does the checking')
    assert.deepStrictEqual(reopened.groupKey, groupKey)
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
    await assert.rejects(deriveGroupKey(account, ref, { commitment: 'v2.00' }), /format v2/)
    await assert.rejects(
      deriveGroupKey(account, ref, { commitment: 'v1.0123' }),
      /keysmith 0\.1\.0 \(format 1\) data is not supported/
    )
  })

  describe('with a password', function () {
    // Each Argon2id pass is 64 MiB and about a second, slower in a browser
    this.timeout(30_000)
    let locked: Awaited<ReturnType<typeof deriveGroupKey>>

    before(async () => {
      locked = await deriveGroupKey(account, ref, { password: 'caf\u00e9' })
    })

    it('derives a different key than without one', async () => {
      assert.notEqual(bytesToHex(locked.groupKey), bytesToHex((await deriveGroupKey(account, ref)).groupKey))
    })

    it('reopens with the same password in any Unicode normal form', async () => {
      const again = await deriveGroupKey(account, ref, { password: 'cafe\u0301', commitment: locked.commitment })
      assert.equal(bytesToHex(again.groupKey), bytesToHex(locked.groupKey))
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
      await assert.rejects(deriveGroupKey(signer, ref, { password: 'x', commitment: 'v2.00' }), /format v2/)
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
    assert.deepStrictEqual(DOMAIN, { name: 'Filecoin Encryption', version: '2' })
    assert.equal(separator(), '0x600ac060fc1e8108d7641090bc17bbfedcd465fe84f93ac6b0ef67c29f491b92')
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
    const groupKey = await groupKeyOf(account, ref)
    const salt = newSalt()
    const foundElsewhere = JSON.parse(JSON.stringify(pieceMetadata(ref, { salt })))
    assert.deepStrictEqual(keyForEnvelope(groupKey, foundElsewhere), pieceKey(groupKey, salt))
  })

  it('refuses an envelope in a future format, clearly', async () => {
    const groupKey = await groupKeyOf(account, ref)
    const future = { ...pieceMetadata(ref, { salt: newSalt() }), 'foc/v': 3 } as never
    assert.throws(() => keyForEnvelope(groupKey, future), /not format 2/)
  })

  it('refuses malformed envelope metadata clearly, rather than deriving from it', () => {
    const groupKey = new Uint8Array(32).fill(7)
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'a/b' })
    assert.throws(() => keyForEnvelope(groupKey, null as never), /envelope metadata must be an object/)
    const hostile = [
      [{ 'foc/salt': 'hello' }, /piece salt is hex bytes/],
      [{ 'foc/salt': '0x' }, /piece salt is hex bytes/],
      [{ 'foc/salt': 5 }, /piece salt must be a string/],
      [{ 'foc/salt': undefined }, /piece salt must be a string/],
      [{ 'foc/group': 5 }, /group path must be a string/],
      [{ 'foc/gkid': '0xzz' }, /group key id is 16 bytes/],
    ] as const
    for (const [fields, error] of hostile) {
      assert.throws(() => keyForEnvelope(groupKey, { ...metadata, ...fields } as never), error, JSON.stringify(fields))
    }
    assert.throws(() => keyForEnvelope(groupKey, metadata, { group: 5 } as never), /group path must be a string/)
  })

  it('given the grant, refuses a piece from another group key or owner with a clear reason', async () => {
    const groupKey = await groupKeyOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'team/notes' })
    const grant = grantDescriptor(ref, 'group:team')
    const teamKey = keyForGroup(groupKey, 'team')
    assert.deepStrictEqual(
      keyForEnvelope(teamKey, metadata, grant),
      keyForEnvelope(teamKey, metadata, holdingOf(grant))
    )
    const otherGroupKey = grantDescriptor({ ...ref, groupKeyId: newGroupKeyId() }, 'group:team')
    assert.throws(
      () => keyForEnvelope(teamKey, metadata, otherGroupKey),
      /This key is for group key 0x.*; the piece is in/
    )
    const otherOwner = grantDescriptor(
      { ...ref, owner: privateKeyToAccount(generatePrivateKey()).address },
      'group:team'
    )
    assert.throws(() => keyForEnvelope(teamKey, metadata, otherOwner), /This key is from owner/)
  })

  it('writes only a 16-byte hex salt', () => {
    assert.throws(() => pieceMetadata(ref, { salt: 'hello' as never }), /piece salt is hex bytes/)
    assert.throws(() => pieceMetadata(ref, { salt: '0x2a' }), /16 random bytes/)
    assert.throws(() => pieceKey(new Uint8Array(32), 'hello' as never), /piece salt is hex bytes/)
  })
})

describe('groups', () => {
  it('give a group key holder and a group holder the same piece key', async () => {
    const groupKey = await groupKeyOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'agent-memory' })
    assert.deepStrictEqual(
      keyForEnvelope(groupKey, metadata),
      keyForEnvelope(keyForGroup(groupKey, 'agent-memory'), metadata, { group: 'agent-memory' })
    )
  })

  it("says so when a group's key is used on a piece with no group", async () => {
    const groupKey = await groupKeyOf(account, ref)
    const unlabelled = pieceMetadata(ref, { salt: newSalt() })
    assert.throws(
      () => keyForEnvelope(keyForGroup(groupKey, 'agent-memory'), unlabelled, { group: 'agent-memory' }),
      /does not contain/
    )
  })

  it('are canonicalised: NFC, case kept, no padding', async () => {
    const groupKey = await groupKeyOf(account, ref)
    assert.deepStrictEqual(keyForGroup(groupKey, 'café'), keyForGroup(groupKey, 'café'))
    assert.notDeepStrictEqual(keyForGroup(groupKey, 'Finance'), keyForGroup(groupKey, 'finance'))
    assert.equal(groupName('café'), 'café')
    assert.throws(() => keyForGroup(groupKey, ''), /non-empty/)
    assert.throws(() => pieceMetadata(ref, { salt: newSalt(), group: 'secret ' }), /whitespace/)
  })
})

describe('holdingOf', () => {
  it('reads the level back off a grant, and refuses what it does not understand', () => {
    assert.equal(holdingOf({ node: 'groupKey' }), 'groupKey')
    assert.deepStrictEqual(holdingOf({ node: 'group:agent-memory' }), { group: 'agent-memory' })
    assert.throws(() => holdingOf({ node: 'dataset' }), /Unrecognised grant node/)
    assert.throws(() => holdingOf({ node: 'scope:invoices' }), /Unrecognised grant node/)
    assert.throws(() => holdingOf({ node: 'keyspace' }), /Unrecognised grant node/)
  })

  it('enforces v when present, and allows node-only input', () => {
    const named = /keysmith 0\.1\.0 \(format 1\) data is not supported/
    assert.equal(holdingOf({ node: 'groupKey' }), 'groupKey')
    assert.equal(holdingOf({ v: 2, node: 'groupKey' }), 'groupKey')
    for (const v of [1, '1']) assert.throws(() => holdingOf({ v, node: 'groupKey' }), named)
    for (const v of [3, '2', 2.5, null]) {
      const unsupported = new RegExp(`Unsupported grant version: ${JSON.stringify(v)}`)
      assert.throws(() => holdingOf({ v, node: 'groupKey' }), unsupported)
    }
  })

  it('writeTarget and keyForEnvelope require the descriptor v to be exactly 2', async () => {
    const named = /keysmith 0\.1\.0 \(format 1\) data is not supported/
    const descriptor = grantDescriptor(ref, 'groupKey')
    const groupKey = await groupKeyOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt() })
    const run = {
      writeTarget: (d: GrantDescriptor) => writeTarget(d, new Uint8Array(32)),
      keyForEnvelope: (d: GrantDescriptor) => keyForEnvelope(groupKey, metadata, d),
    }
    for (const [name, f] of Object.entries(run)) {
      assert.doesNotThrow(() => f(descriptor), `${name} v 2`)
      for (const v of [1, '1']) assert.throws(() => f({ ...descriptor, v } as never), named, `${name} v ${v}`)
      for (const v of [3, '2', undefined]) {
        const unsupported = new RegExp(
          `Unsupported grant version: ${v === undefined ? 'undefined' : JSON.stringify(v)}`
        )
        assert.throws(() => f({ ...descriptor, v } as never), unsupported, `${name} v ${v}`)
      }
    }
  })

  it('refuses a keysmith 0.1.0 grant by name, before reading its node', async () => {
    const format1 = { v: 1, node: 'scope:a', owner: ref.owner, keyspace: ref.groupKeyId } as never
    const named = /keysmith 0\.1\.0 \(format 1\) data is not supported/
    assert.throws(() => holdingOf(format1), named)
    assert.throws(() => holdingOf({ ...(format1 as object), node: 'keyspace' } as never), named)
    assert.throws(() => writeTarget(format1, new Uint8Array(32)), named)
    const groupKey = await groupKeyOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt() })
    assert.throws(() => keyForEnvelope(groupKey, metadata, format1), named)
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
    assert.deepStrictEqual(grantDescriptor(ref, 'group:café'), {
      v: 2,
      node: 'group:café',
      owner: account.address.toLowerCase(),
      groupKeyId: ref.groupKeyId,
    })
  })

  it('record the owner on every piece, without it affecting the key', () => {
    const owned = pieceMetadata(ref, { salt: newSalt(), group: 'agent-memory' })
    const groupKey = new Uint8Array(32).fill(7)
    assert.equal(owned['foc/own'], account.address.toLowerCase(), 'the group key owner, lowercased')
    const relabelled = { ...owned, 'foc/own': '0x0000000000000000000000000000000000000000' as const }
    assert.deepStrictEqual(
      keyForEnvelope(groupKey, relabelled),
      keyForEnvelope(groupKey, owned),
      'derivation ignores it'
    )
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
    const groupKey = await groupKeyOf(account, ref)
    const deep = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret/secret/internal' })
    const expected = keyForEnvelope(groupKey, deep)
    assert.deepStrictEqual(
      keyForEnvelope(keyForGroup(groupKey, 'super-secret'), deep, { group: 'super-secret' }),
      expected
    )
    assert.deepStrictEqual(
      keyForEnvelope(keyForGroup(groupKey, 'super-secret/secret'), deep, { group: 'super-secret/secret' }),
      expected
    )

    const upper = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret' })
    assert.throws(
      () => keyForEnvelope(keyForGroup(groupKey, 'super-secret/secret'), upper, { group: 'super-secret/secret' }),
      /does not contain/
    )
    const sibling = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret/finance' })
    assert.throws(
      () => keyForEnvelope(keyForGroup(groupKey, 'super-secret/secret'), sibling, { group: 'super-secret/secret' }),
      /does not contain/
    )
  })

  it('gives siblings unrelated keys: neither opens the other', async () => {
    const groupKey = await groupKeyOf(account, ref)
    const salt = newSalt()
    assert.notDeepStrictEqual(keyForGroup(groupKey, 'super-secret'), keyForGroup(groupKey, 'secret'))
    assert.notDeepStrictEqual(
      pieceKey(keyForGroup(groupKey, 'super-secret'), salt),
      pieceKey(keyForGroup(groupKey, 'secret'), salt)
    )
  })

  it('derives a child from its parent, so position is part of the key', async () => {
    const groupKey = await groupKeyOf(account, ref)
    assert.notDeepStrictEqual(
      keyForGroup(groupKey, 'secret'),
      keyForGroup(groupKey, 'super-secret/secret'),
      'same name, different parent'
    )
    assert.notDeepStrictEqual(keyForGroup(groupKey, 'a/b'), keyForGroup(groupKey, 'b/a'))
  })

  it('canonicalises paths, and refuses empty segments and stray slashes', () => {
    assert.equal(groupPath('Super/cafe\u0301'), 'Super/caf\u00e9')
    assert.throws(() => groupPath('super-secret//secret'), /non-empty/)
    assert.throws(() => groupPath('/super-secret'), /non-empty/)
    assert.throws(() => groupName('a/b'), /no "\/"/)
    assert.deepStrictEqual(holdingOf({ node: 'group:super-secret/cafe\u0301' }), { group: 'super-secret/caf\u00e9' })
  })

  it('refuses lone surrogates, which would derive the same key as U+FFFD', () => {
    // team/\ud800 and team/\ufffd encode to the same UTF-8, so they must not both be groups.
    assert.throws(() => groupPath('team/\ud800'), /well-formed/)
    assert.throws(() => groupName('x\udc00'), /well-formed/)
    assert.throws(() => holdingOf({ node: 'group:team/\ud800' }), /well-formed/)
    assert.equal(groupPath('team/\ufffd'), 'team/\ufffd')
    assert.equal(groupName('key-\u{1F511}'), 'key-\u{1F511}') // a properly paired surrogate is fine
  })
})

describe('writeTarget', () => {
  it('lets a group grant write under its own group, or beneath it, and nowhere else', async () => {
    const groupKey = await groupKeyOf(account, ref)
    const grant = grantDescriptor(ref, 'group:admin/finance')
    const financeKey = keyForGroup(groupKey, 'admin/finance')

    const own = writeTarget(grant, financeKey)
    assert.equal(own.group, 'admin/finance', 'defaults to the grant’s own group')
    assert.deepStrictEqual(own.key, financeKey)
    assert.deepStrictEqual(own.ref, { owner: grant.owner, groupKeyId: ref.groupKeyId })

    const deeper = writeTarget(grant, financeKey, 'admin/finance/clerks')
    const salt = newSalt()
    const metadata = pieceMetadata(deeper.ref, { salt, group: deeper.group })
    assert.deepStrictEqual(
      pieceKey(deeper.key, salt),
      keyForEnvelope(groupKey, metadata),
      'the owner can read what the delegate wrote'
    )

    assert.throws(() => writeTarget(grant, financeKey, 'admin'), /cannot write under "admin"/)
    assert.throws(() => writeTarget(grant, financeKey, 'admin/legal'), /cannot write under/)
  })

  it('lets a group key grant write under any group, or none', async () => {
    const groupKey = await groupKeyOf(account, ref)
    const grant = grantDescriptor(ref, 'groupKey')
    assert.equal(writeTarget(grant, groupKey).group, undefined)
    assert.deepStrictEqual(writeTarget(grant, groupKey).key, groupKey)
    assert.deepStrictEqual(writeTarget(grant, groupKey, 'agent-memory').key, keyForGroup(groupKey, 'agent-memory'))
  })
})

describe('commitment', () => {
  it('matches only the owner’s key for that group key id', async () => {
    const { groupKey, commitment: c } = await deriveGroupKey(account, ref)
    assert.ok(matchesCommitment(groupKey, c))
    assert.ok(
      !matchesCommitment(await groupKeyOf(account, { ...ref, groupKeyId: newGroupKeyId() }), c),
      'another group key id'
    )
    const other = privateKeyToAccount(generatePrivateKey())
    assert.ok(!matchesCommitment(await groupKeyOf(other, { ...ref, owner: other.address }), c), 'another wallet')
  })

  it('refuses a value in any other format, and a keysmith 0.1.0 one by name', async () => {
    const groupKey = await groupKeyOf(account, ref)
    for (const bad of ['v3.0123456789abcdef0123456789abcdef', 'v2.0123', 'v2.0.0123456789abcdef0123456789abcdef']) {
      assert.throws(() => matchesCommitment(groupKey, bad), /format v2/, bad)
    }
    for (const old of ['v1.0123456789abcdef0123456789abcdef', 'v1.0123']) {
      assert.throws(() => matchesCommitment(groupKey, old), /keysmith 0\.1\.0 \(format 1\) data is not supported/, old)
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
    const groupKey = await groupKeyOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret' })
    const key = keyForEnvelope(groupKey, metadata)
    assert.equal(pieceNode(metadata), `piece:${metadata['foc/salt']}`)
    assert.equal(
      pieceNode({ ...metadata, 'foc/salt': '0x00ABCDEF0123456789ABCDEF01234567' }),
      'piece:0x00abcdef0123456789abcdef01234567'
    )
    const holding = holdingOf(grantDescriptor(ref, pieceNode(metadata)))
    assert.deepStrictEqual(keyForEnvelope(key, metadata, holding), key)
    const neighbour = pieceMetadata(ref, { salt: newSalt(), group: 'super-secret' })
    assert.throws(() => keyForEnvelope(key, neighbour, holding), /another piece/)
  })

  it('cannot write: a piece key belongs to one existing piece', async () => {
    const groupKey = await groupKeyOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt() })
    const grant = grantDescriptor(ref, `piece:${metadata['foc/salt']}`)
    assert.throws(() => writeTarget(grant, keyForEnvelope(groupKey, metadata)), /cannot write/)
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

describe('readPieceMetadata', () => {
  const salt = '0x000102030405060708090a0b0c0d0e0f' as const
  const written = pieceMetadata(ref, { salt, group: 'admin/finance' })

  it('writes format 2, and reads it back as canonical labels', () => {
    assert.deepStrictEqual(Object.keys(written).sort(), ['foc/gkid', 'foc/group', 'foc/own', 'foc/salt', 'foc/v'])
    assert.equal(written['foc/v'], 2)
    assert.deepStrictEqual(Object.keys(pieceMetadata(ref, { salt })).sort(), [
      'foc/gkid',
      'foc/own',
      'foc/salt',
      'foc/v',
    ])
    assert.deepStrictEqual(readPieceMetadata(written), {
      owner: written['foc/own'],
      groupKeyId: ref.groupKeyId,
      group: 'admin/finance',
      salt,
    })
    assert.equal(readPieceMetadata({ ...written, 'foc/group': undefined }).group, undefined)
  })

  it('is strict about the version and the group key id', () => {
    assert.throws(() => readPieceMetadata({ ...written, 'foc/v': 3 }), /not format 2/)
    assert.throws(() => readPieceMetadata({ ...written, 'foc/v': undefined }), /not format 2/)
    assert.throws(() => readPieceMetadata({ ...written, 'foc/v': '2' }), /foc\/v "2"/, 'a string is shown as a string')
    assert.throws(
      () => readPieceMetadata({ ...written, 'foc/gkid': undefined }),
      /not format 2 with a group key.*foc\/gkid/
    )
    assert.throws(() => readPieceMetadata(undefined), /must be an object/)
  })

  it('refuses a keysmith 0.1.0 envelope by name, before reading anything else', () => {
    const format1 = {
      'foc/v': 1,
      'foc/own': written['foc/own'],
      'foc/ks': ref.groupKeyId,
      'foc/scope': 'admin/finance',
      'foc/salt': salt,
    }
    assert.throws(() => readPieceMetadata(format1), /keysmith 0\.1\.0 \(format 1\) data is not supported/)
  })

  it('refuses foc/v "1" as a string as 0.1.0 too, but "2" as a string is just refused', () => {
    assert.throws(
      () => readPieceMetadata({ ...written, 'foc/v': '1' }),
      /keysmith 0\.1\.0 \(format 1\) data is not supported/
    )
    assert.throws(() => readPieceMetadata({ ...written, 'foc/v': '2' }), /not format 2/)
  })

  it('canonicalises nodes, and refuses malformed ones', () => {
    assert.equal(canonicalNode('groupKey'), 'groupKey')
    assert.equal(canonicalNode('group:cafe\u0301'), 'group:caf\u00e9')
    assert.equal(canonicalNode(`piece:${salt.toUpperCase().replace('0X', '0x')}`), `piece:${salt}`)
    assert.deepStrictEqual(nodeKind('group:a/b'), { kind: 'group', path: 'a/b' })
    assert.throws(() => nodeKind('group:a/'), /A group name must be non-empty/)
    assert.throws(() => nodeKind('groupKey:x'), /Unrecognised grant node/)
  })
})

describe('data set metadata', () => {
  const id = ref.groupKeyId
  const kc = 'v2.00112233445566778899aabbccddeeff'

  it('reads the group key id, canonical', () => {
    assert.equal(groupKeyIdOf({ 'foc/gkid': id }), id)
    assert.equal(groupKeyIdOf({ 'foc/gkid': id.toUpperCase().replace('0X', '0x') }), id)
    assert.equal(groupKeyIdOf({ 'foc/kc': kc }), undefined)
    assert.equal(groupKeyIdOf({}), undefined)
  })

  it('returns undefined for a keysmith 0.1.0 data set, so a lookup skips it', () => {
    assert.equal(groupKeyIdOf({ 'foc/ks': id, 'foc/kc': 'v1.00112233445566778899aabbccddeeff' }), undefined)
  })

  it('refuses metadata that is not an object, clearly', () => {
    assert.throws(() => groupKeyIdOf(null as never), /Data set metadata must be an object, got null/)
    assert.throws(() => groupKeyIdOf(undefined as never), /Data set metadata must be an object, got undefined/)
  })

  it('refuses malformed or non-string values', () => {
    assert.throws(() => groupKeyIdOf({ 'foc/gkid': '0xzz' }), /group key id is 16 bytes/)
    assert.throws(() => groupKeyIdOf({ 'foc/gkid': null } as never), /must be a string, got null/)
  })

  it('reads a null-prototype object', () => {
    const m = Object.assign(Object.create(null), { 'foc/gkid': id })
    assert.equal(groupKeyIdOf(m), id)
    assert.equal(groupKeyIdOf(Object.create(null)), undefined)
  })

  it('writes foc/gkid and the commitment, canonical, and refuses a bad commitment', () => {
    const upper = { owner: ref.owner, groupKeyId: id.toUpperCase().replace('0X', '0x') as Hex }
    assert.deepStrictEqual(dataSetMetadata(upper, kc), { 'foc/gkid': id, [COMMITMENT_KEY]: kc })
    assert.deepStrictEqual(Object.keys(dataSetMetadata(ref, kc)), ['foc/gkid', 'foc/kc'])
    assert.throws(() => dataSetMetadata(ref, 'v2.00'), /Not a group key commitment in format v2/)
    assert.throws(() => dataSetMetadata(ref, kc.toUpperCase()), /Not a group key commitment in format v2/)
    assert.throws(() => dataSetMetadata(ref, 'v1.00112233445566778899aabbccddeeff'), /format 1\) data is not supported/)
    assert.throws(() => dataSetMetadata({ ...ref, groupKeyId: '0xzz' as Hex }, kc), /group key id is 16 bytes/)
  })

  it('round-trips', () => {
    const upper = { owner: ref.owner, groupKeyId: id.toUpperCase().replace('0X', '0x') as Hex }
    assert.equal(groupKeyIdOf(dataSetMetadata(upper, kc)), groupKeyId(upper.groupKeyId))
  })
})

describe('piece salt labels', () => {
  const written = pieceMetadata(ref, { salt: newSalt(), group: 'team' })
  const groupKey = new Uint8Array(32).fill(7)

  it('are exactly 16 bytes of hex, on read as on write', () => {
    for (const salt of ['0xab', `0x${'ab'.repeat(17)}`, 5, undefined]) {
      const bent = { ...written, 'foc/salt': salt } as never
      assert.throws(() => readPieceMetadata(bent), /piece salt/, `readPieceMetadata ${salt}`)
      assert.throws(() => keyForEnvelope(groupKey, bent), /piece salt/, `keyForEnvelope ${salt}`)
      assert.throws(() => pieceNode(bent), /piece salt/, `pieceNode ${salt}`)
    }
    assert.throws(
      () => readPieceMetadata({ ...written, 'foc/salt': '0xab' }),
      /16 random bytes, from newSalt\(\); got 1/
    )
    assert.equal(
      readPieceMetadata({ ...written, 'foc/salt': written['foc/salt'].toUpperCase().replace('0X', '0x') }).salt,
      written['foc/salt']
    )
  })
})

describe('labels are own properties', () => {
  const written = pieceMetadata(ref, { salt: newSalt() })
  const { 'foc/own': _own, ...ungated } = written

  it('ignore what an object only inherits', () => {
    const inherited = Object.create({ 'foc/group': 'a' }) as Record<string, unknown>
    Object.assign(inherited, ungated)
    assert.equal(readPieceMetadata(inherited).group, undefined)
    // A label that is only inherited is missing
    const { 'foc/gkid': _id, ...noGkid } = ungated
    const noId = Object.assign(Object.create({ 'foc/gkid': ref.groupKeyId }), noGkid)
    assert.throws(() => readPieceMetadata(noId), /not format 2 with a group key/)
    const onlyInherited = Object.create(written) as Record<string, unknown>
    assert.throws(() => readPieceMetadata(onlyInherited), /not format 2/)
    assert.equal(groupKeyIdOf(Object.create({ 'foc/gkid': ref.groupKeyId })), undefined)
    assert.throws(() => pieceNode(Object.create(written)), /piece salt/)
  })

  it('are not changed by a polluted Object.prototype', () => {
    const polluted = Object.prototype as Record<string, unknown>
    try {
      polluted['foc/group'] = 'admin'
      polluted['foc/own'] = '0x00000000000000000000000000000000000000ff'
      polluted['foc/gkid'] = '0xffeeddccbbaa99887766554433221100'
      polluted['foc/v'] = 3
      const view = readPieceMetadata(ungated)
      assert.equal(view.group, undefined)
      assert.equal(view.owner, undefined)
      assert.equal(view.groupKeyId, ref.groupKeyId)
      assert.deepStrictEqual(keyForEnvelope(new Uint8Array(32), ungated), keyForEnvelope(new Uint8Array(32), ungated))
      assert.equal(groupKeyIdOf({}), undefined)
      assert.equal(groupLabelOf(ungated), undefined)
      assert.equal(labelsGroupKeyId(ungated), ref.groupKeyId)
    } finally {
      delete polluted['foc/group']
      delete polluted['foc/own']
      delete polluted['foc/gkid']
      delete polluted['foc/v']
    }
  })

  it('still read a null-prototype object, as FEE returns', () => {
    const bare = Object.assign(Object.create(null), written)
    assert.deepStrictEqual(readPieceMetadata(bare), readPieceMetadata(written))
    assert.equal(keyForEnvelope(new Uint8Array(32), bare).length, 32)
  })
})
