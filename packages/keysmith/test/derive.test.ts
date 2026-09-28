import { secp256k1 } from '@noble/curves/secp256k1'
import assert from 'assert'
import { bytesToHex, hashDomain, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  DOMAIN,
  datasetKeyMessage,
  datasetKeys,
  grantDescriptor,
  holdingOf,
  keyForEnvelope,
  lowSrs,
  newClientDataSetId,
  newSalt,
  pieceKey,
  pieceMetadata,
  scopeKey,
  scopeName,
} from '../src/derive.ts'
import type { DatasetRef, TypedDataSigner } from '../src/types.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: DatasetRef = {
  chainId: 314159,
  service: '0xfcDDd1E5BC2658fB7483B8e2fa72d8368756F5A3',
  payer: account.address,
  clientDataSetId: 42n,
}
const dkOf = async (signer: TypedDataSigner, r: DatasetRef) => (await datasetKeys(signer, r)).dk

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

describe('datasetKeyMessage', () => {
  it('names the dataset and defaults the epoch', () => {
    const message = datasetKeyMessage(ref)
    assert.equal(message.purpose, 'foc/enc/v1 dataset key')
    assert.equal(message.chainId, 314159n)
    assert.equal(message.clientDataSetId, 42n)
    assert.equal(message.epoch, 0)
  })
})

describe('datasetKeys', () => {
  it('derives the same key for the same wallet and dataset', async () => {
    assert.deepStrictEqual(await dkOf(account, ref), await dkOf(account, ref))
  })

  it('derives an unrelated key for another dataset', async () => {
    assert.notDeepStrictEqual(await dkOf(account, ref), await dkOf(account, { ...ref, clientDataSetId: 43n }))
  })

  it('derives an unrelated key for another wallet', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    assert.notDeepStrictEqual(await dkOf(account, ref), await dkOf(other, { ...ref, payer: other.address }))
  })

  it('returns a commitment that is stable, public and dataset-specific', async () => {
    const a = await datasetKeys(account, ref)
    const b = await datasetKeys(account, ref)
    const other = await datasetKeys(account, { ...ref, clientDataSetId: 43n })
    assert.equal(a.commitment, b.commitment)
    assert.notEqual(a.commitment, other.commitment)
    assert.match(a.commitment, /^v1\.[0-9a-f]{32}$/)
    assert.ok(!a.commitment.includes(bytesToHex(a.dk).slice(2, 34)), 'the commitment must not contain the key')
  })

  it('signs twice on a signer’s first use, and once after that', async () => {
    const signer = counting(account)
    await datasetKeys(signer, ref)
    assert.equal(signer.calls, 2, 'first use: sign, sign again, compare')
    await datasetKeys(signer, { ...ref, clientDataSetId: 43n })
    assert.equal(signer.calls, 3, 'the signer is now known to be deterministic')
    await datasetKeys(signer, ref, { verifySigner: true })
    assert.equal(signer.calls, 5, 'checking can be forced')

    const vetted = counting(account)
    await datasetKeys(vetted, ref, { verifySigner: false })
    assert.equal(vetted.calls, 1, 'or skipped for a signer already vetted')
  })

  it('rejects a randomising signer', async () => {
    let calls = 0
    const r = bytesToHex(new Uint8Array(32).fill(1))
    const flaky: TypedDataSigner = {
      signTypedData: async () => `${r}${(++calls).toString(16).padStart(64, '0')}1b` as const,
    }
    await assert.rejects(datasetKeys(flaky, ref), /not deterministic/)
  })

  it('refuses a signature that is not plain ECDSA', async () => {
    // What an ERC-1271 account might answer: an ABI-encoded blob whose first
    // 64 bytes are offsets — structure, not secret.
    const abiLike: TypedDataSigner = {
      signTypedData: async () => `0x${'20'.padStart(64, '0')}${'41'.padStart(64, '0')}${'ab'.repeat(65)}` as const,
    }
    await assert.rejects(datasetKeys(abiLike, ref), /64- or 65-byte/)
  })
})

describe('lowSrs', () => {
  const r = bytesToHex(new Uint8Array(32).fill(0xab))
  const asSig = (s: bigint, v = '1b') => `${r}${s.toString(16).padStart(64, '0')}${v}` as `0x${string}`

  it('drops v and normalises a high-S signature to the low form', () => {
    const low = 0x0123456789abcdefn
    const fromLow = lowSrs(asSig(low, '1b'))
    const fromHigh = lowSrs(asSig(secp256k1.CURVE.n - low, '1c'))
    assert.equal(fromLow.length, 64)
    assert.deepStrictEqual(fromLow, fromHigh, 'both malleable forms must yield one key')
  })

  it('accepts a 64-byte r‖s with no v', () => {
    const sig = asSig(7n, '')
    assert.equal(hexToBytes(sig).length, 64)
    assert.deepStrictEqual(lowSrs(sig), lowSrs(asSig(7n)))
  })

  it('rejects any other length', () => {
    assert.throws(() => lowSrs('0xdeadbeef'), /64- or 65-byte/)
    assert.throws(() => lowSrs(`${asSig(7n)}00`), /64- or 65-byte/)
    assert.throws(() => lowSrs(`0x${'00'.repeat(96)}`), /64- or 65-byte/)
  })

  it('rejects r or s outside [1, n−1]', () => {
    assert.throws(() => lowSrs(asSig(0n)), /\[1, n−1\]/)
    assert.throws(() => lowSrs(asSig(secp256k1.CURVE.n)), /\[1, n−1\]/)
    const zeroR = `0x${'00'.repeat(32)}${7n.toString(16).padStart(64, '0')}1b` as const
    assert.throws(() => lowSrs(zeroR), /\[1, n−1\]/)
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
    assert.notEqual(zeroed, separator(), 'zero-filling the fields is a different domain, so a different key')
  })

  it('binds the chain and the service through the message instead', async () => {
    const here = await dkOf(account, ref)
    assert.notDeepStrictEqual(here, await dkOf(account, { ...ref, chainId: 314 }))
    assert.notDeepStrictEqual(
      here,
      await dkOf(account, { ...ref, service: '0x00000000000000000000000000000000000000ff' })
    )
  })
})

describe('derivation tree', () => {
  it('separates scopes, and pieces within a scope', async () => {
    const dk = await dkOf(account, ref)
    const invoices = scopeKey(dk, 'invoices')
    const payroll = scopeKey(dk, 'payroll')
    assert.notDeepStrictEqual(invoices, payroll)

    const salt = newSalt()
    assert.notDeepStrictEqual(pieceKey(invoices, salt), pieceKey(payroll, salt))
    assert.notDeepStrictEqual(pieceKey(dk, salt), pieceKey(dk, newSalt()))
  })

  it('gives a dataset holder and a scope holder the same piece key', async () => {
    const dk = await dkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), scope: 'invoices' })
    assert.deepStrictEqual(keyForEnvelope(dk, metadata), keyForEnvelope(scopeKey(dk, 'invoices'), metadata, 'scope'))
  })

  it('keeps an unscoped piece out of any scope', async () => {
    const dk = await dkOf(account, ref)
    const salt = newSalt()
    const metadata = pieceMetadata(ref, { salt })
    assert.equal(metadata['foc/scope'], undefined)
    assert.deepStrictEqual(keyForEnvelope(dk, metadata), pieceKey(dk, salt))
  })

  it('says so when a scope key is used on a piece at the root', async () => {
    const dk = await dkOf(account, ref)
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
    const dk = await dkOf(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), scope: 'invoices' })
    assert.deepStrictEqual(
      keyForEnvelope(scopeKey(dk, 'invoices'), metadata, holdingOf({ node: 'scope:invoices' })),
      keyForEnvelope(dk, metadata)
    )
  })
})

describe('pieceMetadata', () => {
  it('records what a reader needs and nothing secret', () => {
    const salt = newSalt()
    assert.deepStrictEqual(pieceMetadata(ref, { salt, scope: 'invoices' }), {
      'foc/v': 1,
      'foc/cds': '0x2a',
      'foc/epoch': 0,
      'foc/scope': 'invoices',
      'foc/salt': salt,
    })
  })
})

describe('grantDescriptor', () => {
  it('spells the id exactly as the envelope does', () => {
    const descriptor = grantDescriptor(ref, 'dataset')
    assert.equal(descriptor.clientDataSetId, '0x2a')
    assert.equal(descriptor.clientDataSetId, pieceMetadata(ref, { salt: newSalt() })['foc/cds'])
  })

  it('lowercases addresses, whatever spelling it was given', () => {
    const checksummed = grantDescriptor({ ...ref, service: '0xfcDDd1E5BC2658fB7483B8e2fa72d8368756F5A3' }, 'dataset')
    const lower = grantDescriptor({ ...ref, service: '0xfcddd1e5bc2658fb7483b8e2fa72d8368756f5a3' }, 'dataset')
    assert.deepStrictEqual(checksummed, lower)
    assert.equal(checksummed.payer, account.address.toLowerCase())
  })

  it('carries what the descriptor is for, and nothing secret', () => {
    assert.deepStrictEqual(grantDescriptor(ref, 'scope:invoices'), {
      v: 1,
      node: 'scope:invoices',
      chainId: ref.chainId,
      epoch: 0,
      service: ref.service.toLowerCase(),
      payer: account.address.toLowerCase(),
      clientDataSetId: '0x2a',
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

describe('canonical forms', () => {
  it('normalises scope names to NFC, keeps case, and rejects padding', async () => {
    const dk = await dkOf(account, ref)
    assert.deepStrictEqual(scopeKey(dk, 'caf\u00e9'), scopeKey(dk, 'cafe\u0301'), 'NFC and NFD are one scope')
    assert.notDeepStrictEqual(scopeKey(dk, 'Invoices'), scopeKey(dk, 'invoices'), 'case is significant')
    assert.equal(scopeName('cafe\u0301'), 'caf\u00e9')
    assert.throws(() => scopeKey(dk, ''), /non-empty/)
    assert.throws(() => scopeKey(dk, ' invoices'), /whitespace/)
    assert.throws(() => pieceMetadata(ref, { salt: newSalt(), scope: 'invoices ' }), /whitespace/)
  })

  it('lowercases the salt wherever it is used, and keeps its leading zeros', async () => {
    const dk = await dkOf(account, ref)
    const upper = '0x00CDEF0123456789ABCDEF0123456789' as const
    assert.deepStrictEqual(pieceKey(dk, upper), pieceKey(dk, '0x00cdef0123456789abcdef0123456789'))
    assert.notDeepStrictEqual(pieceKey(dk, upper), pieceKey(dk, '0xcdef0123456789abcdef0123456789'))
    assert.equal(pieceMetadata(ref, { salt: upper })['foc/salt'], '0x00cdef0123456789abcdef0123456789')
  })

  it('carries the epoch and a canonical node in the descriptor', () => {
    const d = grantDescriptor({ ...ref, epoch: 3 }, 'scope:cafe\u0301')
    assert.equal(d.epoch, 3)
    assert.equal(d.node, 'scope:caf\u00e9')
    assert.equal(grantDescriptor(ref, 'dataset').epoch, 0)
    assert.throws(() => grantDescriptor(ref, 'scope:'), /non-empty/)
  })
})
