import { secp256k1 } from '@noble/curves/secp256k1'
import assert from 'assert'
import { bytesToHex, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  commitment,
  datasetKey,
  datasetKeyMessage,
  datasetSecret,
  holdingOf,
  keyForEnvelope,
  lowSrs,
  newClientDataSetId,
  newSalt,
  pieceKey,
  pieceMetadata,
  scopeKey,
} from '../src/derive.ts'
import type { DatasetRef, TypedDataSigner } from '../src/types.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: DatasetRef = {
  chainId: 314159,
  service: '0xfcDDd1E5BC2658fB7483B8e2fa72d8368756F5A3',
  payer: account.address,
  clientDataSetId: 42n,
}

describe('datasetKeyMessage', () => {
  it('names the dataset and defaults the epoch', () => {
    const message = datasetKeyMessage(ref)
    assert.equal(message.purpose, 'foc/enc/v1 dataset key')
    assert.equal(message.chainId, 314159n)
    assert.equal(message.clientDataSetId, 42n)
    assert.equal(message.epoch, 0)
  })
})

describe('datasetSecret', () => {
  it('derives the same key for the same wallet and dataset', async () => {
    const once = datasetKey(await datasetSecret(account, ref))
    const twice = datasetKey(await datasetSecret(account, ref))
    assert.deepEqual(once, twice)
  })

  it('derives an unrelated key for another dataset', async () => {
    const a = datasetKey(await datasetSecret(account, ref))
    const b = datasetKey(await datasetSecret(account, { ...ref, clientDataSetId: 43n }))
    assert.notDeepEqual(a, b)
  })

  it('derives an unrelated key for another wallet', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    const a = datasetKey(await datasetSecret(account, ref))
    const b = datasetKey(await datasetSecret(other, { ...ref, payer: other.address }))
    assert.notDeepEqual(a, b)
  })

  it('rejects a randomising signer', async () => {
    let calls = 0
    const flaky: TypedDataSigner = {
      signTypedData: async () => `0x${String(++calls).padStart(130, '0')}` as const,
    }
    await assert.rejects(datasetSecret(flaky, ref), /not deterministic/)
  })
})

describe('lowSrs', () => {
  it('drops v and normalises a high-S signature to the low form', () => {
    const r = new Uint8Array(32).fill(0xab)
    const low = 0x0123456789abcdefn
    const high = secp256k1.CURVE.n - low

    const asSig = (s: bigint, v: string) => `${bytesToHex(r)}${s.toString(16).padStart(64, '0')}${v}` as `0x${string}`

    const fromLow = lowSrs(asSig(low, '1b'))
    const fromHigh = lowSrs(asSig(high, '1c'))
    assert.equal(fromLow.length, 64)
    assert.deepEqual(fromLow, fromHigh, 'both malleable forms must yield one key')
  })

  it('rejects a short signature', () => {
    assert.throws(() => lowSrs('0xdeadbeef'), /64- or 65-byte/)
  })
})

describe('commitment', () => {
  it('is stable, public and dataset-specific', async () => {
    const secret = await datasetSecret(account, ref)
    const other = await datasetSecret(account, { ...ref, clientDataSetId: 43n })
    assert.equal(commitment(secret), commitment(secret))
    assert.notEqual(commitment(secret), commitment(other))
    assert.match(commitment(secret), /^v1\.[0-9a-f]{32}$/)
  })

  it('does not leak the dataset key', async () => {
    const secret = await datasetSecret(account, ref)
    assert.ok(!commitment(secret).includes(bytesToHex(datasetKey(secret)).slice(2, 34)))
  })
})

describe('derivation tree', () => {
  it('separates scopes, and pieces within a scope', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const invoices = scopeKey(dk, 'invoices')
    const payroll = scopeKey(dk, 'payroll')
    assert.notDeepEqual(invoices, payroll)

    const salt = newSalt()
    assert.notDeepEqual(pieceKey(invoices, salt), pieceKey(payroll, salt))
    assert.notDeepEqual(pieceKey(dk, salt), pieceKey(dk, newSalt()))
  })

  it('gives a dataset holder and a scope holder the same piece key', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const salt = newSalt()
    const metadata = pieceMetadata(ref, { salt, scope: 'invoices' })
    assert.deepEqual(keyForEnvelope(dk, metadata), keyForEnvelope(scopeKey(dk, 'invoices'), metadata, 'scope'))
  })

  it('keeps an unscoped piece out of any scope', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const salt = newSalt()
    const metadata = pieceMetadata(ref, { salt })
    assert.equal(metadata['foc/scope'], undefined)
    assert.deepEqual(keyForEnvelope(dk, metadata), pieceKey(dk, salt))
  })

  it('says so when a scope key is used on a piece at the root', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const metadata = pieceMetadata(ref, { salt: newSalt() })
    assert.throws(
      () => keyForEnvelope(scopeKey(dk, 'invoices'), metadata, 'scope'),
      /not in a scope/,
      'better a clear error than a key that fails later at the AEAD tag'
    )
  })
})

describe('holdingOf', () => {
  it('reads the level back off a grant', () => {
    assert.equal(holdingOf({ node: 'dataset' }), 'dataset')
    assert.equal(holdingOf({ node: 'scope:invoices' }), 'scope')
    assert.equal(holdingOf({ node: 'scope:with:colons' }), 'scope')
  })

  it('refuses a node it does not understand', () => {
    assert.throws(() => holdingOf({ node: 'folder:2026' }), /Unrecognised grant node/)
    assert.throws(() => holdingOf({ node: 'piece' }), /Unrecognised grant node/)
  })

  it('round-trips with what a scope grant would carry', async () => {
    const dk = datasetKey(await datasetSecret(account, ref))
    const salt = newSalt()
    const metadata = pieceMetadata(ref, { salt, scope: 'invoices' })
    const grant = { node: 'scope:invoices' }
    assert.deepEqual(keyForEnvelope(scopeKey(dk, 'invoices'), metadata, holdingOf(grant)), keyForEnvelope(dk, metadata))
  })
})

describe('pieceMetadata', () => {
  it('records what a reader needs and nothing secret', () => {
    const salt = newSalt()
    const metadata = pieceMetadata(ref, { salt, scope: 'invoices' })
    assert.deepEqual(metadata, {
      'foc/v': 1,
      'foc/cds': '0x2a',
      'foc/epoch': 0,
      'foc/scope': 'invoices',
      'foc/salt': salt,
    })
  })
})

describe('identifiers', () => {
  it('mints distinct salts and client data set ids', () => {
    assert.notEqual(newSalt(), newSalt())
    assert.notEqual(newClientDataSetId(), newClientDataSetId())
    assert.equal(hexToBytes(newSalt()).length, 16)
  })
})
