import { assert } from 'chai'
import { serviceURLJoin } from '../src/utils/service-url.ts'

describe('serviceURLJoin', () => {
  it('keeps the serviceURL path without a trailing slash', () => {
    assert.strictEqual(
      serviceURLJoin('pdp/piece/pull', 'https://sp.example/curio').toString(),
      'https://sp.example/curio/pdp/piece/pull'
    )
  })

  it('keeps the serviceURL path with a trailing slash', () => {
    assert.strictEqual(
      serviceURLJoin('pdp/piece/pull', 'https://sp.example/curio/').toString(),
      'https://sp.example/curio/pdp/piece/pull'
    )
  })

  it('handles bare origins', () => {
    assert.strictEqual(serviceURLJoin('pdp/ping', 'https://sp.example').toString(), 'https://sp.example/pdp/ping')
    assert.strictEqual(serviceURLJoin('pdp/ping', 'https://sp.example/').toString(), 'https://sp.example/pdp/ping')
  })

  it('keeps query strings in the path', () => {
    assert.strictEqual(
      serviceURLJoin('pdp/piece?pieceCid=abc', 'https://sp.example/curio').toString(),
      'https://sp.example/curio/pdp/piece?pieceCid=abc'
    )
  })
})
