import assert from 'assert'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { datasetKey, datasetSecret, scopeKey } from '../src/derive.ts'
import type { DatasetRef, GrantDescriptor } from '../src/types.ts'
import { publicKeyOf, unwrapWith, wrapTo } from '../src/wrap.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: DatasetRef = {
  chainId: 314159,
  service: '0xfcDDd1E5BC2658fB7483B8e2fa72d8368756F5A3',
  payer: account.address,
  clientDataSetId: 42n,
}
const descriptor: GrantDescriptor = {
  v: 1,
  node: 'dataset',
  chainId: ref.chainId,
  service: ref.service,
  payer: ref.payer,
  clientDataSetId: '42',
}

describe('wrapTo / unwrapWith', () => {
  it('round-trips a dataset key to the named recipient', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const recipient = generatePrivateKey()

    const grant = await wrapTo(publicKeyOf(recipient), dk, descriptor)
    assert.equal(grant.alg, 'ECDH-ES+A256GCM/secp256k1')
    assert.equal(grant.node, 'dataset')
    assert.deepEqual(await unwrapWith(recipient, grant), dk)
  })

  it('survives JSON delivery', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const recipient = generatePrivateKey()

    const grant = await wrapTo(publicKeyOf(recipient), dk, descriptor)
    const delivered = JSON.parse(JSON.stringify(grant))
    assert.deepEqual(await unwrapWith(recipient, delivered), dk)
  })

  it('tells a stranger nothing', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const grant = await wrapTo(publicKeyOf(generatePrivateKey()), dk, descriptor)
    await assert.rejects(unwrapWith(generatePrivateKey(), grant))
  })

  it('refuses a grant relabelled as another node', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), dk, descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, node: 'scope:payroll' }))
    await assert.rejects(unwrapWith(recipient, { ...grant, clientDataSetId: '43' }))
  })

  it('does not care what order the descriptor was built in', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), dk, descriptor)
    const reordered = {
      ...grant,
      ...(Object.fromEntries(Object.entries(descriptor).reverse()) as GrantDescriptor),
    }
    assert.deepEqual(await unwrapWith(recipient, reordered), dk)
  })

  it('carries a scope key just as well', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const sk = scopeKey(dk, 'invoices')
    const recipient = generatePrivateKey()

    const grant = await wrapTo(publicKeyOf(recipient), sk, { ...descriptor, node: 'scope:invoices' })
    const opened = await unwrapWith(recipient, grant)
    assert.deepEqual(opened, sk)
    assert.notDeepEqual(opened, dk)
  })

  it('rejects an unknown algorithm', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const recipient = generatePrivateKey()
    const grant = await wrapTo(publicKeyOf(recipient), dk, descriptor)
    await assert.rejects(unwrapWith(recipient, { ...grant, alg: 'RSA-OAEP' } as never), /Unsupported grant algorithm/)
  })
})
