import { secp256k1 } from '@noble/curves/secp256k1.js'
import assert from 'assert'
import { decode, encode } from 'cborg'
import { bytesToHex, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  deriveGroupKey,
  grantDescriptor,
  holdingOf,
  keyForEnvelope,
  keyForGroup,
  newSalt,
  pieceMetadata,
} from '../src/derive.ts'
import type { Grant, GroupKeyRef } from '../src/types.ts'
import { decodeGrant, encodeGrant, publicKeyOf, unwrapWith, wrapTo } from '../src/wrap.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: GroupKeyRef = { owner: account.address, groupKeyId: '0x00112233445566778899aabbccddeeff' }
const descriptor = grantDescriptor(ref, 'groupKey')
const groupKeyOf = async () => (await deriveGroupKey(account, ref)).groupKey

describe('publicKeyOf', () => {
  it('is a derived key-agreement key, not the signing key', () => {
    const k = generatePrivateKey()
    assert.notEqual(publicKeyOf(k), bytesToHex(secp256k1.getPublicKey(hexToBytes(k), false)))
    assert.equal(publicKeyOf(k), publicKeyOf(k))
  })
})

describe('wrapTo / unwrapWith', () => {
  it('round-trips a group key to the named recipient, as bytes', async () => {
    const groupKey = await groupKeyOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), groupKey, descriptor)
    assert.equal(grant.v, 2)
    const bytes = encodeGrant(grant)
    assert.ok(bytes.length < 200, `${bytes.length} bytes`)
    assert.deepStrictEqual(await unwrapWith(recipient, bytes), groupKey)
    assert.deepStrictEqual(decodeGrant(bytes), grant)
  })

  it('accepts a compressed recipient key', async () => {
    const groupKey = await groupKeyOf()
    const recipient = generatePrivateKey()
    const compressed = bytesToHex(secp256k1.Point.fromBytes(hexToBytes(publicKeyOf(recipient))).toBytes(true))
    assert.deepStrictEqual(await unwrapWith(recipient, await wrapTo(compressed, groupKey, descriptor)), groupKey)
  })

  it('tells a stranger nothing', async () => {
    const grant = await wrapTo(publicKeyOf(generatePrivateKey()), await groupKeyOf(), descriptor)
    await assert.rejects(unwrapWith(generatePrivateKey(), grant))
  })

  it('refuses a grant relabelled as another node, group key or owner', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await groupKeyOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, node: 'group:super-secret' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, groupKeyId: '0xffeeddccbbaa99887766554433221100' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, owner: '0x00000000000000000000000000000000000000ff' }))
  })

  it('opens a grant whose relay mangled the spelling of every field', async () => {
    const groupKey = await groupKeyOf()
    const recipient = generatePrivateKey()
    const cafeKey = keyForGroup(groupKey, 'café')
    const grant = await wrapTo(publicKeyOf(recipient), cafeKey, grantDescriptor(ref, 'group:café'))
    const mangled = {
      ...grant,
      node: 'group:café',
      owner: grant.owner.toUpperCase().replace('0X', '0x'),
      groupKeyId: grant.groupKeyId.toUpperCase().replace('0X', '0x'),
    }
    assert.deepStrictEqual(await unwrapWith(recipient, mangled as never), cafeKey)
  })

  it('treats fields outside the descriptor as informational', async () => {
    const groupKey = await groupKeyOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), groupKey, descriptor)
    const carried: Grant = { ...grant, ...{ dataSetId: '7', note: 'replica on SP 2' } }
    assert.deepStrictEqual(await unwrapWith(recipient, carried), groupKey)
  })

  it("carries a group's key, and holdingOf reads the level back", async () => {
    const groupKey = await groupKeyOf()
    const recipient = generatePrivateKey()
    const agentMemoryKey = keyForGroup(groupKey, 'agent-memory')
    const grant = await wrapTo(publicKeyOf(recipient), agentMemoryKey, grantDescriptor(ref, 'group:agent-memory'))
    assert.deepStrictEqual(await unwrapWith(recipient, grant), agentMemoryKey)
    assert.deepStrictEqual(holdingOf(grant), { group: 'agent-memory' })
  })

  it('carries one piece key, and opens only that piece', async () => {
    const groupKey = await groupKeyOf()
    const recipient = generatePrivateKey()
    const metadata = pieceMetadata(ref, { salt: newSalt(), group: 'agent-memory' })
    const key = keyForEnvelope(groupKey, metadata)
    const grant = await wrapTo(publicKeyOf(recipient), key, grantDescriptor(ref, `piece:${metadata['foc/salt']}`))
    const delivered = decodeGrant(encodeGrant({ ...grant, pieceCid: 'bafk…' }))
    assert.equal(delivered.pieceCid, 'bafk…', 'informational fields travel with the bytes')
    const node = await unwrapWith(recipient, delivered)
    assert.deepStrictEqual(keyForEnvelope(node, metadata, holdingOf(delivered)), key)
    await assert.rejects(unwrapWith(recipient, { ...grant, node: `piece:${newSalt()}` }), 'relabelled to another piece')
  })

  it('rejects grants it does not understand', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await groupKeyOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, alg: 'RSA-OAEP' } as never), /Unsupported grant algorithm/)
    await assert.rejects(unwrapWith(recipient, { ...grant, v: 3 } as never), /Unsupported grant version: 3/)
    await assert.rejects(
      unwrapWith(recipient, { ...grant, v: 1 } as never),
      /keysmith 0\.1\.0 \(format 1\) data is not supported/
    )
    const { groupKeyId: _dropped, ...withoutGroupKey } = grant
    await assert.rejects(unwrapWith(recipient, withoutGroupKey as never))
  })

  it('refuses a malformed grant clearly, before any decryption', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await groupKeyOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, null as never), /A grant must be an object/)
    await assert.rejects(unwrapWith(recipient, 'a grant' as never), /A grant must be an object/)
    const malformed = [
      [{ owner: 7 }, /owner must be a string/],
      [{ owner: 'alice' }, /owner must be an address/],
      [{ node: null }, /grant node must be a string/],
      [{ groupKeyId: 5 }, /group key id must be a string/],
      [{ epk: undefined }, /epk must be a string/],
      [{ epk: 'hello' }, /epk must be 65 bytes of hex/],
      [{ epk: `0x02${grant.epk.slice(4, 68)}` }, /epk must be 65 bytes of hex/],
      [{ epk: `0x04${'11'.repeat(64)}` }, /not on curve/],
      [{ iv: `0x${'00'.repeat(16)}` }, /iv must be 12 bytes of hex/],
      [{ ct: `0x${'00'.repeat(15)}` }, /ct must be 48 bytes of hex/],
    ] as const
    for (const [fields, error] of malformed) {
      await assert.rejects(unwrapWith(recipient, { ...grant, ...fields } as never), error, JSON.stringify(fields))
    }
  })

  it('authenticates none of the informational fields carried in the bytes', async () => {
    const groupKey = await groupKeyOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), groupKey, descriptor)
    const relabelled = { ...decodeGrant(encodeGrant({ ...grant, dataSetId: '7' })), dataSetId: '8' }
    assert.deepStrictEqual(await unwrapWith(recipient, encodeGrant(relabelled)), groupKey)
  })

  it('refuses bytes that are not one canonical version 2 grant', async () => {
    const recipient = generatePrivateKey()
    const bytes = encodeGrant(await wrapTo(publicKeyOf(recipient), await groupKeyOf(), descriptor))
    const fields = decode(bytes, { useMaps: true }) as Map<number | string, unknown>
    const reencoded = (change: (m: Map<number | string, unknown>) => void) => {
      const m = new Map(fields)
      change(m)
      return encode(m)
    }
    const refused = [
      [new Uint8Array(), /not canonical CBOR/],
      [new Uint8Array([...bytes, 0]), /not canonical CBOR/],
      [new Uint8Array([0xa2, 0x00, 0x01, 0x00, 0x01]), /not canonical CBOR/], // the same key twice
      [new Uint8Array([0xbf, ...bytes.slice(1), 0xff]), /not canonical CBOR/], // indefinite length
      [new Uint8Array([0xc0, ...bytes]), /not canonical CBOR/], // tagged
      [encode([1, 2]), /expected a CBOR map/],
      [reencoded((m) => m.set(7, 1)), /unknown field 7/],
      [reencoded((m) => m.set(0, 3)), /Unsupported grant version: 3/],
      [reencoded((m) => m.set(0, 1)), /keysmith 0\.1\.0 \(format 1\) data is not supported/],
      [reencoded((m) => m.set(2, account.address)), /owner must be 20 bytes/],
      [reencoded((m) => m.set(6, (m.get(6) as Uint8Array).slice(1))), /ct must be 48 bytes/],
      [reencoded((m) => m.delete(1)), /grant node must be a string/],
    ] as const
    for (const [input, error] of refused) {
      assert.throws(() => decodeGrant(input), error)
      await assert.rejects(unwrapWith(recipient, input), error)
    }
  })

  it('says plainly when a well-formed grant does not open', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await groupKeyOf(), descriptor)
    await assert.rejects(unwrapWith(generatePrivateKey(), grant), /does not open with this key/, 'a stranger')
    const otherOwner = privateKeyToAccount(generatePrivateKey()).address
    await assert.rejects(
      unwrapWith(recipient, { ...grant, owner: otherOwner }),
      /does not open with this key/,
      'relabelled'
    )
  })

  it('wraps only a version it writes, and carries exactly the canonical descriptor', async () => {
    const groupKey = await groupKeyOf()
    const recipient = generatePrivateKey()
    await assert.rejects(
      wrapTo(publicKeyOf(recipient), groupKey, { ...descriptor, v: 3 } as never),
      /Unsupported grant version/
    )
    await assert.rejects(
      wrapTo(publicKeyOf(recipient), groupKey, { ...descriptor, v: 1 } as never),
      /keysmith 0\.1\.0 \(format 1\) data is not supported/
    )
    const handBuilt = {
      v: 2,
      node: 'group:cafe\u0301',
      owner: account.address,
      groupKeyId: ref.groupKeyId.toUpperCase().replace('0X', '0x'),
      dataSetId: '7',
    }
    const grant = await wrapTo(publicKeyOf(recipient), keyForGroup(groupKey, 'caf\u00e9'), handBuilt as never)
    const { alg: _a, epk: _e, iv: _i, ct: _c, ...carried } = grant
    assert.deepStrictEqual(carried, grantDescriptor(ref, 'group:caf\u00e9'), 'canonical, and nothing extra')
  })

  it('refuses something that is not a private key where one is needed', async () => {
    const grant = await wrapTo(publicKeyOf(generatePrivateKey()), await groupKeyOf(), descriptor)
    assert.throws(() => publicKeyOf(account.address), /32-byte secp256k1 private key/, 'an address')
    assert.throws(() => publicKeyOf(`0x${'00'.repeat(32)}`), /32-byte secp256k1 private key/, 'zero')
    assert.throws(() => publicKeyOf(`0x${'ff'.repeat(32)}`), /32-byte secp256k1 private key/, 'above the order')
    await assert.rejects(unwrapWith(account.address, grant), /32-byte secp256k1 private key/)
  })

  it('only wraps a 32-byte node key', async () => {
    await assert.rejects(wrapTo(publicKeyOf(generatePrivateKey()), new Uint8Array(16), descriptor), /32-byte node key/)
  })
})
