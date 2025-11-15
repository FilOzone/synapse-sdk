import assert from 'assert'

import type { Account, Chain, Client, Hex, Transport } from 'viem'
import { createWalletClient, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { decodeEndorsement, decodeEndorsements, encodeEndorsements, signEndorsement } from '../src/utils/cert.ts'

describe('Endorsement Certificates', () => {
  let client: Client<Transport, Chain, Account>
  beforeEach(async () => {
    client = createWalletClient({
      account: privateKeyToAccount(generatePrivateKey()),
      transport: http(),
      chain: calibration,
    })
  })

  it('should decode from the signed encoding the same account that signed', async () => {
    const providerId = 10n
    const notAfter = 0xffffffffffffffffn
    const encoded = await signEndorsement(client, {
      notAfter,
      providerId,
    })
    assert.equal(encoded.length, 164)

    const { address, endorsement } = await decodeEndorsement(providerId, client.chain.id, encoded)
    assert.equal(address, client.account.address)
    assert.equal(endorsement.notAfter, notAfter)

    const [keys, values] = encodeEndorsements({
      [address ?? '']: endorsement,
    })
    assert.equal(keys.length, values.length)
    assert.equal(keys.length, 1)
    assert.equal(values.length, 1)
    assert.equal(values[0], encoded)
  })

  it('should decode multiple valid endorsements', async () => {
    const providerId = 15n
    const notAfter = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now

    // Create multiple clients
    const client2 = createWalletClient({
      account: privateKeyToAccount(generatePrivateKey()),
      transport: http(),
      chain: calibration,
    })
    const client3 = createWalletClient({
      account: privateKeyToAccount(generatePrivateKey()),
      transport: http(),
      chain: calibration,
    })

    // Sign endorsements from different accounts
    const encoded1 = await signEndorsement(client, { notAfter, providerId })
    const encoded2 = await signEndorsement(client2, { notAfter, providerId })
    const encoded3 = await signEndorsement(client3, { notAfter, providerId })

    const capabilities = {
      endorsement0: encoded1,
      endorsement1: encoded2,
      endorsement2: encoded3,
    }

    const result = await decodeEndorsements(providerId, client.chain.id, capabilities)

    // Should have 3 valid endorsements
    assert.equal(Object.keys(result).length, 3)

    // Verify all addresses are present and correct
    assert.ok(result[client.account.address])
    assert.ok(result[client2.account.address])
    assert.ok(result[client3.account.address])

    // Verify endorsement data
    assert.equal(result[client.account.address].notAfter, notAfter)
    assert.equal(result[client2.account.address].notAfter, notAfter)
    assert.equal(result[client3.account.address].notAfter, notAfter)
  })

  it('should handle mixed valid and invalid endorsements', async () => {
    const providerId = 20n
    const notAfter = BigInt(Math.floor(Date.now() / 1000) + 3600)

    // Create valid endorsement
    const validEncoded = await signEndorsement(client, { notAfter, providerId })

    const capabilities: Record<string, Hex> = {
      blabla: '0xdeadbeef',
      endorsement0: validEncoded,
      endorsement1: '0x1234' as Hex, // Invalid - too short
      endorsement2: `0x${'a'.repeat(162)}` as Hex, // Invalid - wrong format
      endorsement3: `0x${'0'.repeat(162)}` as Hex, // Invalid - all zeros
    }

    const result = await decodeEndorsements(providerId, client.chain.id, capabilities)

    // Should only have the valid endorsement
    assert.equal(Object.keys(result).length, 1)
    assert.ok(result[client.account.address])
    assert.equal(result[client.account.address].notAfter, notAfter)
  })

  it('should filter out expired endorsements', async () => {
    const providerId = 25n
    const futureTime = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
    const pastTime = BigInt(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago

    // Create endorsements with different expiry times
    const validEncoded = await signEndorsement(client, { notAfter: futureTime, providerId })
    const expiredEncoded = await signEndorsement(client, { notAfter: pastTime, providerId })

    const capabilities = {
      endorsement0: validEncoded,
      endorsement1: expiredEncoded,
    }

    const result = await decodeEndorsements(providerId, client.chain.id, capabilities)

    // Should only have the non-expired endorsement
    assert.equal(Object.keys(result).length, 1)
    assert.ok(result[client.account.address])
    assert.equal(result[client.account.address].notAfter, futureTime)
  })

  it('should handle empty capabilities', async () => {
    const providerId = 30n
    const capabilities = {}

    const result = await decodeEndorsements(providerId, client.chain.id, capabilities)

    // Should return empty object
    assert.deepEqual(result, {})
  })
})
