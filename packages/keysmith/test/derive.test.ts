import { secp256k1 } from '@noble/curves/secp256k1'
import assert from 'assert'
import { bytesToHex, hashDomain, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  commitment,
  commitmentEpoch,
  DOMAIN,
  epochOf,
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
  roleKey,
  roleName,
  rolePath,
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
  it('names the owner and keyspace, defaults the epoch, and signs nothing about chains or datasets', () => {
    const message = keyspaceKeyMessage(ref)
    assert.equal(message.purpose, 'foc/enc/v1 keyspace key')
    assert.equal(message.keyspace, ref.keyspace)
    assert.equal(message.epoch, 0)
    assert.deepStrictEqual(Object.keys(message).sort(), ['epoch', 'keyspace', 'owner', 'purpose'])
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
    assert.equal(c, commitment(kk, 0))
    assert.match(c, /^v1\.0\.[0-9a-f]{32}$/)
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
    const { kk, descriptor } = await keyspaceKeys(account, { ...ref, epoch: 4 })
    assert.deepStrictEqual(descriptor, grantDescriptor({ ...ref, epoch: 4 }, 'keyspace'))
    const target = writeTarget(descriptor, kk, 'agent-memory')
    const salt = newSalt()
    const metadata = pieceMetadata(target.ref, { salt, role: target.role })
    assert.equal(metadata['foc/epoch'], 4, 'the epoch comes from what was signed')
    assert.deepStrictEqual(pieceKey(target.key, salt), keyForEnvelope(kk, metadata))
  })

  it('signs twice on a signer’s first use, and once after that', async () => {
    const signer = counting(account)
    await keyspaceKeys(signer, ref)
    assert.equal(signer.calls, 2, 'first use: sign, sign again, compare')
    await keyspaceKeys(signer, { ...ref, keyspace: newKeyspace() })
    assert.equal(signer.calls, 3, 'the signer is now known to be deterministic')
    await keyspaceKeys(signer, ref, { verifySigner: true })
    assert.equal(signer.calls, 5, 'checking can be forced')
    const vetted = counting(account)
    await keyspaceKeys(vetted, ref, { verifySigner: false })
    assert.equal(vetted.calls, 1, 'or skipped for a signer already vetted')
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

describe('roles', () => {
  it('give a keyspace holder and a role holder the same piece key', async () => {
    const kk = await kkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), role: 'agent-memory' })
    assert.deepStrictEqual(
      keyForEnvelope(kk, metadata),
      keyForEnvelope(roleKey(kk, 'agent-memory'), metadata, { role: 'agent-memory' })
    )
  })

  it('say so when a role key is used on a piece with no role', async () => {
    const kk = await kkOf(account, ref)
    const unlabelled = pieceMetadata(ref, { salt: newSalt() })
    assert.throws(
      () => keyForEnvelope(roleKey(kk, 'agent-memory'), unlabelled, { role: 'agent-memory' }),
      /does not contain/
    )
  })

  it('are canonicalised: NFC, case kept, no padding', async () => {
    const kk = await kkOf(account, ref)
    assert.deepStrictEqual(roleKey(kk, 'café'), roleKey(kk, 'café'))
    assert.notDeepStrictEqual(roleKey(kk, 'Finance'), roleKey(kk, 'finance'))
    assert.equal(roleName('café'), 'café')
    assert.throws(() => roleKey(kk, ''), /non-empty/)
    assert.throws(() => pieceMetadata(ref, { salt: newSalt(), role: 'secret ' }), /whitespace/)
  })
})

describe('holdingOf', () => {
  it('reads the level back off a grant, and refuses what it does not understand', () => {
    assert.equal(holdingOf({ node: 'keyspace' }), 'keyspace')
    assert.deepStrictEqual(holdingOf({ node: 'role:agent-memory' }), { role: 'agent-memory' })
    assert.throws(() => holdingOf({ node: 'dataset' }), /Unrecognised grant node/)
    assert.throws(() => holdingOf({ node: 'scope:invoices' }), /Unrecognised grant node/)
  })
})

describe('pieceMetadata and grantDescriptor', () => {
  it('record what a reader needs, in canonical form, and nothing secret', () => {
    const salt = '0x00CDEF0123456789ABCDEF0123456789' as const
    assert.deepStrictEqual(pieceMetadata({ ...ref, epoch: 3 }, { salt, role: 'café' }), {
      'foc/v': 1,
      'foc/ks': ref.keyspace,
      'foc/epoch': 3,
      'foc/role': 'café',
      'foc/salt': '0x00cdef0123456789abcdef0123456789',
    })
    assert.deepStrictEqual(grantDescriptor({ ...ref, epoch: 3 }, 'role:café'), {
      v: 1,
      node: 'role:café',
      owner: account.address.toLowerCase(),
      keyspace: ref.keyspace,
      epoch: 3,
    })
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

describe('role tree', () => {
  it('lets a role open every role beneath it, and nothing above or beside it', async () => {
    const kk = await kkOf(account, ref)
    const deep = pieceMetadata(ref, { salt: newSalt(), role: 'super-secret/secret/internal' })
    const expected = keyForEnvelope(kk, deep)
    assert.deepStrictEqual(keyForEnvelope(roleKey(kk, 'super-secret'), deep, { role: 'super-secret' }), expected)
    assert.deepStrictEqual(
      keyForEnvelope(roleKey(kk, 'super-secret/secret'), deep, { role: 'super-secret/secret' }),
      expected
    )

    const upper = pieceMetadata(ref, { salt: newSalt(), role: 'super-secret' })
    assert.throws(
      () => keyForEnvelope(roleKey(kk, 'super-secret/secret'), upper, { role: 'super-secret/secret' }),
      /does not contain/
    )
    const sibling = pieceMetadata(ref, { salt: newSalt(), role: 'super-secret/finance' })
    assert.throws(
      () => keyForEnvelope(roleKey(kk, 'super-secret/secret'), sibling, { role: 'super-secret/secret' }),
      /does not contain/
    )
  })

  it('gives siblings unrelated keys: neither opens the other', async () => {
    const kk = await kkOf(account, ref)
    const salt = newSalt()
    assert.notDeepStrictEqual(roleKey(kk, 'super-secret'), roleKey(kk, 'secret'))
    assert.notDeepStrictEqual(pieceKey(roleKey(kk, 'super-secret'), salt), pieceKey(roleKey(kk, 'secret'), salt))
  })

  it('derives a child from its parent, so position is part of the key', async () => {
    const kk = await kkOf(account, ref)
    assert.notDeepStrictEqual(roleKey(kk, 'secret'), roleKey(kk, 'super-secret/secret'), 'same name, different parent')
    assert.notDeepStrictEqual(roleKey(kk, 'a/b'), roleKey(kk, 'b/a'))
  })

  it('canonicalises paths, and refuses empty segments and stray slashes', () => {
    assert.equal(rolePath('Super/cafe\u0301'), 'Super/caf\u00e9')
    assert.throws(() => rolePath('super-secret//secret'), /non-empty/)
    assert.throws(() => rolePath('/super-secret'), /non-empty/)
    assert.throws(() => roleName('a/b'), /no "\/"/)
    assert.deepStrictEqual(holdingOf({ node: 'role:super-secret/cafe\u0301' }), { role: 'super-secret/caf\u00e9' })
  })
})

describe('writeTarget', () => {
  it('lets a role grant write under its own role, or beneath it, and nowhere else', async () => {
    const kk = await kkOf(account, ref)
    const grant = grantDescriptor({ ...ref, epoch: 2 }, 'role:admin/finance')
    const rk = roleKey(kk, 'admin/finance')

    const own = writeTarget(grant, rk)
    assert.equal(own.role, 'admin/finance', 'defaults to the grant’s own role')
    assert.deepStrictEqual(own.key, rk)
    assert.deepStrictEqual(own.ref, { owner: grant.owner, keyspace: ref.keyspace, epoch: 2 })

    const deeper = writeTarget(grant, rk, 'admin/finance/clerks')
    const salt = newSalt()
    const metadata = pieceMetadata(deeper.ref, { salt, role: deeper.role })
    assert.deepStrictEqual(
      pieceKey(deeper.key, salt),
      keyForEnvelope(kk, metadata),
      'the owner can read what the delegate wrote'
    )

    assert.throws(() => writeTarget(grant, rk, 'admin'), /cannot write under "admin"/)
    assert.throws(() => writeTarget(grant, rk, 'admin/legal'), /cannot write under/)
  })

  it('lets a keyspace grant write under any role, or none', async () => {
    const kk = await kkOf(account, ref)
    const grant = grantDescriptor(ref, 'keyspace')
    assert.equal(writeTarget(grant, kk).role, undefined)
    assert.deepStrictEqual(writeTarget(grant, kk).key, kk)
    assert.deepStrictEqual(writeTarget(grant, kk, 'agent-memory').key, roleKey(kk, 'agent-memory'))
  })
})

describe('epochOf', () => {
  it('accepts a uint32, or one spelled as a decimal string', () => {
    assert.equal(epochOf(0), 0)
    assert.equal(epochOf(0xffffffff), 0xffffffff)
    assert.equal(epochOf('7'), 7)
  })

  it('refuses anything else, everywhere an epoch is recorded', () => {
    for (const bad of [-1, 1.5, 2 ** 32, Number.NaN, '07', '1e3', ' 7', 'seven']) {
      assert.throws(() => epochOf(bad), /An epoch is an integer/, String(bad))
    }
    assert.throws(() => keyspaceKeyMessage({ ...ref, epoch: -1 }), /An epoch/)
    assert.throws(() => pieceMetadata({ ...ref, epoch: 1.5 }, { salt: newSalt() }), /An epoch/)
    assert.throws(() => grantDescriptor({ ...ref, epoch: 2 ** 32 }, 'keyspace'), /An epoch/)
    const fromJson = { ...grantDescriptor(ref, 'keyspace'), epoch: '2' as unknown as number }
    assert.equal(writeTarget(fromJson, new Uint8Array(32)).ref.epoch, 2)
  })
})

describe('commitment', () => {
  it('names its epoch, and matches only that epoch’s key from the owner’s wallet', async () => {
    const { kk, commitment: c0 } = await keyspaceKeys(account, ref)
    const { kk: kk1, commitment: c1 } = await keyspaceKeys(account, { ...ref, epoch: 1 })
    assert.match(c1, /^v1\.1\.[0-9a-f]{32}$/)
    assert.equal(commitmentEpoch(c0), 0)
    assert.equal(commitmentEpoch(c1), 1)
    assert.ok(matchesCommitment(kk, c0))
    assert.ok(matchesCommitment(kk1, c1))
    assert.ok(!matchesCommitment(kk1, c0), 'another epoch')
    const other = privateKeyToAccount(generatePrivateKey())
    assert.ok(!matchesCommitment(await kkOf(other, { ...ref, owner: other.address }), c0), 'another wallet')
  })

  it('refuses a value in any other format', () => {
    for (const bad of ['v2.0123456789abcdef0123456789abcdef', 'v1.0.0123', 'v1.01.0123456789abcdef0123456789abcdef']) {
      assert.throws(() => commitmentEpoch(bad), /format v1/, bad)
    }
  })
})
