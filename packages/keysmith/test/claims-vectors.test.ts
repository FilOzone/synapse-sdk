import assert from 'assert'
import { type Hex, hashTypedData, hexToBytes, recoverTypedDataAddress } from 'viem'
import { type PieceLabels, READ_GRANT_TYPES, READ_REQUEST_TYPES, verifyPresentation } from '../src/claims.ts'
import { DOMAIN } from '../src/derive.ts'
import vectors from './claims-vectors.json' with { type: 'json' }

// Pins what a gating provider must serve or refuse, byte for byte, so other
// implementations (Curio's, in Go) can check themselves against the same file.
describe('claim chain vectors', () => {
  it('pins the EIP-712 domain, types and digests', async () => {
    assert.deepStrictEqual(vectors.domain, DOMAIN)
    const type = (name: string, fields: readonly { name: string; type: string }[]) =>
      `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`
    assert.equal(vectors.types.ReadGrant, type('ReadGrant', READ_GRANT_TYPES.ReadGrant))
    assert.equal(vectors.types.ReadRequest, type('ReadRequest', READ_REQUEST_TYPES.ReadRequest))
    for (const digest of vectors.digests) {
      const request = 'pieceCid' in digest.message
      const m = digest.message as Record<string, unknown>
      const message = { ...m, chainId: BigInt(m.chainId as string), expires: BigInt(m.expires as string) }
      const typed = {
        domain: DOMAIN,
        types: request ? READ_REQUEST_TYPES : READ_GRANT_TYPES,
        primaryType: request ? 'ReadRequest' : 'ReadGrant',
        message,
      } as never
      assert.equal(hashTypedData(typed), digest.hash, digest.what)
      assert.equal(
        await recoverTypedDataAddress({ ...(typed as object), signature: digest.signature as Hex } as never),
        digest.signer,
        digest.what
      )
    }
  })

  for (const c of vectors.cases) {
    it(c.name, async () => {
      const outcome = verifyPresentation(hexToBytes(c.presentation as Hex), {
        pieceCid: hexToBytes(c.pieceCid as Hex),
        piece: c.labels as PieceLabels,
        chainId: BigInt(c.chainId),
        now: c.now,
      })
      if (c.expect.result === 'served') {
        const claim = await outcome
        assert.equal(claim.node, c.expect.node)
        assert.equal(claim.bearer, c.expect.bearer)
      } else {
        await assert.rejects(outcome, (err: Error) => err.message === c.expect.reason)
      }
    })
  }
})
