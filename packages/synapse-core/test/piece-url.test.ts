import { calibration, devnet, mainnet } from '@filoz/synapse-core/chains'
import { assert } from 'chai'
import { createPieceUrl, createPieceUrlPDP } from '../src/utils/piece-url.ts'

describe('createPieceUrl', () => {
  const testCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
  const testAddress = '0x1234567890123456789012345678901234567890'
  const testPdpUrl = 'https://sp.example.com/pdp/'

  describe('CDN URLs', () => {
    const testCases = [
      {
        chain: mainnet,
        expected: `https://${testAddress}.filbeam.io/${testCid}`,
      },
      {
        chain: calibration,
        expected: `https://${testAddress}.calibration.filbeam.io/${testCid}`,
      },
    ]

    for (const { chain, expected } of testCases) {
      it(`should create CDN URL for ${chain.name}`, () => {
        const result = createPieceUrl({ cid: testCid, cdn: true, address: testAddress, chain, serviceURL: testPdpUrl })
        assert.strictEqual(result, expected)
      })
    }

    it('should fall back to PDP URL when chain.filbeam is null', () => {
      const result = createPieceUrl({
        cid: testCid,
        cdn: true,
        address: testAddress,
        chain: devnet,
        serviceURL: testPdpUrl,
      })
      assert.strictEqual(result, `${testPdpUrl}piece/${testCid}`)
    })
  })

  describe('PDP URLs', () => {
    it('should create PDP URL when CDN is disabled', () => {
      const result = createPieceUrl({
        cid: testCid,
        cdn: false,
        address: testAddress,
        chain: mainnet,
        serviceURL: testPdpUrl,
      })
      const expected = `${testPdpUrl}piece/${testCid}`
      assert.strictEqual(result, expected)
    })
  })
})

describe('createPieceUrlPDP', () => {
  it('should create PDP URL', () => {
    const cid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
    const pdpUrl = 'https://sp.example.com/pdp/'
    const result = createPieceUrlPDP({ cid, serviceURL: pdpUrl })
    assert.strictEqual(
      result,
      'https://sp.example.com/pdp/piece/bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
    )
  })
})
