import { secp256k1 } from '@noble/curves/secp256k1'
import assert from 'assert'
import { bytesToHex, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { datasetKeys, grantDescriptor, holdingOf, scopeKey } from '../src/derive.ts'
import type { DatasetRef, Grant, GrantDescriptor } from '../src/types.ts'
import { publicKeyOf, unwrapWith, wrapTo } from '../src/wrap.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: DatasetRef = {
  chainId: 314159,
  service: '0xfcDDd1E5BC2658fB7483B8e2fa72d8368756F5A3',
  payer: account.address,
  clientDataSetId: 42n,
}
const descriptor = grantDescriptor(ref, 'dataset')
const dkOf = async () => (await datasetKeys(account, ref)).dk

describe('publicKeyOf', () => {
  it('is a derived key-agreement key, not the signing key', () => {
    const k = generatePrivateKey()
    const signing = bytesToHex(secp256k1.getPublicKey(hexToBytes(k), false))
    assert.notEqual(publicKeyOf(k), signing, 'one credential, two algorithms, two keys')
    assert.equal(publicKeyOf(k), publicKeyOf(k), 'but stable, so it can be published once')
    assert.equal(hexToBytes(publicKeyOf(k)).length, 65)
  })
})

describe('wrapTo / unwrapWith', () => {
  it('round-trips a dataset key to the named recipient', async () => {
    const dk = await dkOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), dk, descriptor)
    assert.equal(grant.alg, 'ECDH-ES+A256GCM/secp256k1')
    assert.equal(grant.node, 'dataset')
    assert.deepStrictEqual(await unwrapWith(recipient, grant), dk)
  })

  it('survives JSON delivery', async () => {
    const dk = await dkOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), dk, descriptor)
    assert.deepStrictEqual(await unwrapWith(recipient, JSON.parse(JSON.stringify(grant))), dk)
  })

  it('accepts a compressed recipient key and derives the same wrap', async () => {
    const dk = await dkOf()
    const recipient = generatePrivateKey()
    const compressed = bytesToHex(
      secp256k1.ProjectivePoint.fromHex(hexToBytes(publicKeyOf(recipient))).toRawBytes(true)
    )
    const grant = await wrapTo(compressed, dk, descriptor)
    assert.deepStrictEqual(await unwrapWith(recipient, grant), dk)
  })

  it('tells a stranger nothing', async () => {
    const grant = await wrapTo(publicKeyOf(generatePrivateKey()), await dkOf(), descriptor)
    await assert.rejects(unwrapWith(generatePrivateKey(), grant))
  })

  it('refuses a grant relabelled as another node or dataset', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await dkOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, node: 'scope:payroll' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, clientDataSetId: '0x2b' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, chainId: 314 }))
  })

  it('does not care how the addresses were spelled', async () => {
    const dk = await dkOf()
    const recipient = generatePrivateKey()
    const byHand: GrantDescriptor = {
      ...descriptor,
      service: '0xfcDDd1E5BC2658fB7483B8e2fa72d8368756F5A3',
      payer: account.address,
      clientDataSetId: '0x2A',
    }
    const grant = await wrapTo(publicKeyOf(recipient), dk, byHand)
    assert.deepStrictEqual(await unwrapWith(recipient, grant), dk)
    assert.deepStrictEqual(
      await unwrapWith(recipient, { ...grant, ...descriptor }),
      dk,
      'checksummed and lowercase are one grant'
    )
  })

  it('treats fields outside the descriptor as informational', async () => {
    const dk = await dkOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), dk, descriptor)
    const carried: Grant = { ...grant, ...{ dataSetId: '7' } }
    assert.deepStrictEqual(await unwrapWith(recipient, carried), dk, 'not authenticated, so not checked')
  })

  it('carries a scope key just as well, and holdingOf reads it back', async () => {
    const dk = await dkOf()
    const sk = scopeKey(dk, 'invoices')
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), sk, grantDescriptor(ref, 'scope:invoices'))
    const opened = await unwrapWith(recipient, grant)
    assert.deepStrictEqual(opened, sk)
    assert.notDeepStrictEqual(opened, dk)
    assert.equal(holdingOf(grant), 'scope')
  })

  it('rejects a grant it does not understand', async () => {
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), await dkOf(), descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, alg: 'RSA-OAEP' } as never), /Unsupported grant algorithm/)
    await assert.rejects(unwrapWith(recipient, { ...grant, v: 2 } as never), /Unsupported grant version/)
  })

  it('only wraps a 32-byte node key', async () => {
    await assert.rejects(wrapTo(publicKeyOf(generatePrivateKey()), new Uint8Array(16), descriptor), /32-byte node key/)
  })
})

describe('canonical AAD', () => {
  it('opens a grant whose relay mangled the spelling of every field', async () => {
    const dk = await dkOf()
    const recipient = generatePrivateKey()
    const sk = scopeKey(dk, 'caf\u00e9')
    const grant = await wrapTo(publicKeyOf(recipient), sk, grantDescriptor(ref, 'scope:caf\u00e9'))
    const mangled = {
      ...grant,
      node: 'scope:cafe\u0301',
      chainId: '314159',
      epoch: '0',
      clientDataSetId: '0x002A',
      service: grant.service.toUpperCase().replace('0X', '0x'),
    }
    assert.deepStrictEqual(await unwrapWith(recipient, mangled as never), sk)
  })

  it('binds the epoch, and refuses a grant without one', async () => {
    const dk = await dkOf()
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), dk, grantDescriptor(ref, 'dataset'))
    await assert.rejects(unwrapWith(recipient, { ...grant, epoch: 1 }))
    const { epoch: _dropped, ...withoutEpoch } = grant
    await assert.rejects(unwrapWith(recipient, withoutEpoch as never), /epoch/)
    await assert.rejects(unwrapWith(recipient, { ...grant, chainId: 1.5 }), /chainId/)
  })
})
