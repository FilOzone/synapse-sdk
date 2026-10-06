import { secp256k1 } from '@noble/curves/secp256k1'
import assert from 'assert'
import { bytesToHex, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { grantDescriptor, holdingOf, keyspaceKeys, roleKey } from '../src/derive.ts'
import type { Grant, KeyspaceRef } from '../src/types.ts'
import { publicKeyOf, unwrapWith, wrapTo } from '../src/wrap.ts'

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
  it('round-trips a keyspace key to the named recipient, through JSON', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), kk, descriptor)
    assert.equal(grant.v, 2)
    assert.deepStrictEqual(await unwrapWith(recipient, JSON.parse(JSON.stringify(grant))), kk)
  })

  it('accepts a compressed recipient key', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const compressed = bytesToHex(
      secp256k1.ProjectivePoint.fromHex(hexToBytes(publicKeyOf(recipient))).toRawBytes(true)
    )
    assert.deepStrictEqual(await unwrapWith(recipient, await wrapTo(compressed, kk, descriptor)), kk)
  })

  it('tells a stranger nothing', async () => {
    const grant = await wrapTo(publicKeyOf(generatePrivateKey()), await kkOf(), descriptor)
    await assert.rejects(unwrapWith(generatePrivateKey(), grant))
  })

  it('refuses a grant relabelled as another node, keyspace, owner or epoch', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await kkOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, node: 'role:super-secret' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, keyspace: '0xffeeddccbbaa99887766554433221100' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, owner: '0x00000000000000000000000000000000000000ff' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, epoch: 1 }))
  })

  it('opens a grant whose relay mangled the spelling of every field', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const rk = roleKey(kk, 'café')
    const grant = await wrapTo(publicKeyOf(recipient), rk, grantDescriptor(ref, 'role:café'))
    const mangled = {
      ...grant,
      node: 'role:café',
      owner: grant.owner.toUpperCase().replace('0X', '0x'),
      keyspace: grant.keyspace.toUpperCase().replace('0X', '0x'),
      epoch: '0',
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

  it('carries a role key, and holdingOf reads the level back', async () => {
    const kk = await kkOf()
    const recipient = generatePrivateKey()
    const rk = roleKey(kk, 'agent-memory')
    const grant = await wrapTo(publicKeyOf(recipient), rk, grantDescriptor(ref, 'role:agent-memory'))
    assert.deepStrictEqual(await unwrapWith(recipient, grant), rk)
    assert.deepStrictEqual(holdingOf(grant), { role: 'agent-memory' })
  })

  it('rejects grants it does not understand, including the previous format', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await kkOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, alg: 'RSA-OAEP' } as never), /Unsupported grant algorithm/)
    await assert.rejects(unwrapWith(recipient, { ...grant, v: 1 } as never), /Unsupported grant version/)
    const { epoch: _dropped, ...withoutEpoch } = grant
    await assert.rejects(unwrapWith(recipient, withoutEpoch as never), /epoch/)
  })

  it('only wraps a 32-byte node key', async () => {
    await assert.rejects(wrapTo(publicKeyOf(generatePrivateKey()), new Uint8Array(16), descriptor), /32-byte node key/)
  })
})
