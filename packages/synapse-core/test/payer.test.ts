import { assert } from 'chai'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Mocks from '../src/mocks/jsonrpc/index.ts'
import { accountFromSecp256k1 } from '../src/session-key/secp256k1.ts'
import { getPayerAddress } from '../src/utils/payer.ts'

describe('getPayerAddress', () => {
  it('should return the account address for a wallet account', () => {
    const account = privateKeyToAccount(Mocks.PRIVATE_KEYS.key1)
    assert.strictEqual(getPayerAddress(account), account.address)
  })

  it('should return the root address for a session key account', () => {
    const rootAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address
    const account = accountFromSecp256k1({ privateKey: Mocks.PRIVATE_KEYS.key1, rootAddress })
    assert.strictEqual(getPayerAddress(account), rootAddress)
    assert.notStrictEqual(account.address, rootAddress)
  })
})
