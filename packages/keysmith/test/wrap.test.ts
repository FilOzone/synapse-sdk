import { secp256k1 } from '@noble/curves/secp256k1.js'
import assert from 'assert'
import { decode, encode } from 'cborg'
import { bytesToHex, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  grantDescriptor,
  holdingOf,
  keyForEnvelope,
  keyspaceKeys,
  newSalt,
  pieceMetadata,
  scopeKey,
} from '../src/derive.ts'
import type { Grant, KeyspaceRef } from '../src/types.ts'
import { decodeGrant, encodeGrant, publicKeyOf, unwrapWith, wrapTo } from '../src/wrap.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: KeyspaceRef = { owner: account.address, keyspace: '0x00112233445566778899aabbccddeeff' }
const descriptor = grantDescriptor(ref, 'keyspace')
const kkOf = async () => (await keyspaceKeys(account, ref)).kk

describe('publicKeyOf', () => {
  it('is a derived key-agreement key, not the signing key', () => {
    const k = generatePrivateKey()
    assert.notEqual(publicKeyOf(k), bytesToHex(secp256k1.getPublicKey(hexToBytes(k), false)))
    assert.equal(publicKeyOf(k), publicKeyOf(k))
  })
})

describe('wrapTo / unwrapWith', () => {
  it('round-trips a keyspace key to the named recipient, as bytes', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), kk, descriptor)
    assert.equal(grant.v, 1)
    const bytes = encodeGrant(grant)
    assert.ok(bytes.length < 200, `${bytes.length} bytes`)
    assert.deepStrictEqual(await unwrapWith(recipient, bytes), kk)
    assert.deepStrictEqual(decodeGrant(bytes), grant)
  })

  it('accepts a compressed recipient key', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const compressed = bytesToHex(secp256k1.Point.fromBytes(hexToBytes(publicKeyOf(recipient))).toBytes(true))
    assert.deepStrictEqual(await unwrapWith(recipient, await wrapTo(compressed, kk, descriptor)), kk)
  })

  it('tells a stranger nothing', async () => {
    const grant = await wrapTo(publicKeyOf(generatePrivateKey()), await kkOf(), descriptor)
    await assert.rejects(unwrapWith(generatePrivateKey(), grant))
  })

  it('refuses a grant relabelled as another node, keyspace or owner', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await kkOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, node: 'scope:super-secret' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, keyspace: '0xffeeddccbbaa99887766554433221100' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, owner: '0x00000000000000000000000000000000000000ff' }))
  })

  it('opens a grant whose relay mangled the spelling of every field', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const rk = scopeKey(kk, 'café')
    const grant = await wrapTo(publicKeyOf(recipient), rk, grantDescriptor(ref, 'scope:café'))
    const mangled = {
      ...grant,
      node: 'scope:café',
      owner: grant.owner.toUpperCase().replace('0X', '0x'),
      keyspace: grant.keyspace.toUpperCase().replace('0X', '0x'),
    }
    assert.deepStrictEqual(await unwrapWith(recipient, mangled as never), rk)
  })

  it('treats fields outside the descriptor as informational', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), kk, descriptor)
    const carried: Grant = { ...grant, ...{ dataSetId: '7', note: 'replica on SP 2' } }
    assert.deepStrictEqual(await unwrapWith(recipient, carried), kk)
  })

  it('carries a scope key, and holdingOf reads the level back', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const rk = scopeKey(kk, 'agent-memory')
    const grant = await wrapTo(publicKeyOf(recipient), rk, grantDescriptor(ref, 'scope:agent-memory'))
    assert.deepStrictEqual(await unwrapWith(recipient, grant), rk)
    assert.deepStrictEqual(holdingOf(grant), { scope: 'agent-memory' })
  })

  it('carries one piece key, and opens only that piece', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const metadata = pieceMetadata(ref, { salt: newSalt(), scope: 'agent-memory' })
    const pk = keyForEnvelope(kk, metadata)
    const grant = await wrapTo(publicKeyOf(recipient), pk, grantDescriptor(ref, `piece:${metadata['foc/salt']}`))
    const delivered = decodeGrant(encodeGrant({ ...grant, pieceCid: 'bafk…' }))
    assert.equal(delivered.pieceCid, 'bafk…', 'informational fields travel with the bytes')
    const node = await unwrapWith(recipient, delivered)
    assert.deepStrictEqual(keyForEnvelope(node, metadata, holdingOf(delivered)), pk)
    await assert.rejects(unwrapWith(recipient, { ...grant, node: `piece:${newSalt()}` }), 'relabelled to another piece')
  })

  it('rejects grants it does not understand', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await kkOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, alg: 'RSA-OAEP' } as never), /Unsupported grant algorithm/)
    await assert.rejects(unwrapWith(recipient, { ...grant, v: 2 } as never), /Unsupported grant version/)
    const { keyspace: _dropped, ...withoutKeyspace } = grant
    await assert.rejects(unwrapWith(recipient, withoutKeyspace as never))
  })

  it('refuses a malformed grant clearly, before any decryption', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await kkOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, null as never), /A grant must be an object/)
    await assert.rejects(unwrapWith(recipient, 'a grant' as never), /A grant must be an object/)
    const malformed = [
      [{ owner: 7 }, /owner must be a string/],
      [{ owner: 'alice' }, /owner must be an address/],
      [{ node: null }, /grant node must be a string/],
      [{ keyspace: 5 }, /keyspace id must be a string/],
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
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), kk, descriptor)
    const relabelled = { ...decodeGrant(encodeGrant({ ...grant, dataSetId: '7' })), dataSetId: '8' }
    assert.deepStrictEqual(await unwrapWith(recipient, encodeGrant(relabelled)), kk)
  })

  it('refuses bytes that are not one canonical version 1 grant', async () => {
    const recipient = generatePrivateKey()
    const bytes = encodeGrant(await wrapTo(publicKeyOf(recipient), await kkOf(), descriptor))
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
      [reencoded((m) => m.set(0, 2)), /Unsupported grant version: 2/],
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
    const grant = await wrapTo(publicKeyOf(recipient), await kkOf(), descriptor)
    await assert.rejects(unwrapWith(generatePrivateKey(), grant), /does not open with this key/, 'a stranger')
    const otherOwner = privateKeyToAccount(generatePrivateKey()).address
    await assert.rejects(
      unwrapWith(recipient, { ...grant, owner: otherOwner }),
      /does not open with this key/,
      'relabelled'
    )
  })

  it('wraps only a version it writes, and carries exactly the canonical descriptor', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    await assert.rejects(
      wrapTo(publicKeyOf(recipient), kk, { ...descriptor, v: 2 } as never),
      /Unsupported grant version/
    )
    const handBuilt = {
      v: 1,
      node: 'scope:cafe\u0301',
      owner: account.address,
      keyspace: ref.keyspace.toUpperCase().replace('0X', '0x'),
      dataSetId: '7',
    }
    const grant = await wrapTo(publicKeyOf(recipient), scopeKey(kk, 'caf\u00e9'), handBuilt as never)
    const { alg: _a, epk: _e, iv: _i, ct: _c, ...carried } = grant
    assert.deepStrictEqual(carried, grantDescriptor(ref, 'scope:caf\u00e9'), 'canonical, and nothing extra')
  })

  it('refuses something that is not a private key where one is needed', async () => {
    const grant = await wrapTo(publicKeyOf(generatePrivateKey()), await kkOf(), descriptor)
    assert.throws(() => publicKeyOf(account.address), /32-byte secp256k1 private key/, 'an address')
    assert.throws(() => publicKeyOf(`0x${'00'.repeat(32)}`), /32-byte secp256k1 private key/, 'zero')
    assert.throws(() => publicKeyOf(`0x${'ff'.repeat(32)}`), /32-byte secp256k1 private key/, 'above the order')
    await assert.rejects(unwrapWith(account.address, grant), /32-byte secp256k1 private key/)
  })

  it('only wraps a 32-byte node key', async () => {
    await assert.rejects(wrapTo(publicKeyOf(generatePrivateKey()), new Uint8Array(16), descriptor), /32-byte node key/)
  })
})
