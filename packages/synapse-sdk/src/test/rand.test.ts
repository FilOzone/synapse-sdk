/* globals describe it */
import { assert } from 'chai'
import { randIndex, randU256 } from '../utils/rand.ts'

describe('randIndex', () => {
  it('should return 0 for length 1', () => {
    for (let i = 0; i < 32; i++) {
      assert.equal(0, randIndex(1))
    }
  })
  it('returns both 0 and 1 for length 2', () => {
    const counts = [0, 0]
    for (let i = 0; i < 64; i++) {
      counts[randIndex(counts.length)]++
    }
    // this test can fail probabilistically but the probability is low
    // each bit should be independent with 50% likelihood
    // the probability of getting the same index N times is 2**(1-N)
    // so if this test fails, the 50% assumption is likely wrong
    assert.isAtLeast(counts[0], 1)
    assert.isAtLeast(counts[1], 1)
  })
  it('balances entropy for length 1024', () => {
    const counts = []
    for (let i = 0; i < 10; i++) {
      counts.push([0, 0])
    }
    for (let i = 0; i < 64; i++) {
      let index = randIndex(1024)
      assert.isAtLeast(index, 0)
      assert.isAtMost(index, 1023)
      for (let j = 0; j < 10; j++) {
        counts[j][index & 1]++
        index >>= 1
      }
    }
    // this test can fail probabilistically but the probability is low
    // each bit should be independent with 50% likelihood
    // the probability of getting the same bitvalue N times is 2**(1-N)
    // so if this test fails, the 50% assumption is likely wrong
    for (let i = 0; i < 10; i++) {
      assert.isAtLeast(counts[i][0], 1)
      assert.isAtLeast(counts[i][1], 1)
    }
  })
})

describe('randU256', () => {
  // TODO
  it('currently only returns 0', () => {
    assert.equal(randU256(), BigInt(0))
  })
})
