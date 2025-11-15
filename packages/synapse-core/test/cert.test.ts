import assert from 'assert'

import type { Account, Chain, Client, Transport } from 'viem'
import { createWalletClient, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { decodeEndorsement, encodeEndorsements, signEndorsement } from '../src/utils/cert.ts'

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
})
