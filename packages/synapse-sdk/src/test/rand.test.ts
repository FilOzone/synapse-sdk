/* globals describe it */

import { fallbackRandIndex, fallbackRandU256, randIndex, randU256 } from '@filoz/synapse-core/utils'
import { assert } from 'chai'

const randIndexMethods = [randIndex, fallbackRandIndex]
randIndexMethods.forEach((randIndexMethod) => {
  describe(randIndexMethod.name, () => {
    it('should return 0 for length 1', () => {
      for (let i = 0; i < 32; i++) {
        assert.equal(0, randIndexMethod(1))
      }
    })
    it('returns both 0 and 1 for length 2', () => {
      const counts = [0, 0]
      for (let i = 0; i < 32; i++) {
        counts[randIndexMethod(counts.length)]++
      }
      // this test can fail probabilistically but the probability is low
      // each bit should be independent with 50% likelihood
      // the probability of getting the same index N times is 2**(1-N)
      // so if this test fails, the 50% assumption is likely wrong
      assert.isAtLeast(counts[0], 1)
      assert.isAtLeast(counts[1], 1)
    })
    it('has at least 10 random bits', () => {
      const counts = []
      for (let i = 0; i < 10; i++) {
        counts.push([0, 0])
      }
      for (let i = 0; i < 32; i++) {
        let index = randIndexMethod(1024)
        assert.isAtLeast(index, 0)
        assert.isAtMost(index, 1023)
        for (let j = 0; j < 10; j++) {
          counts[j][index & 1]++
          index >>= 1
        }
        assert.equal(index, 0)
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
})

const randU256Methods = [randU256, fallbackRandU256]
randU256Methods.forEach((randU256Method) => {
  describe(randU256Method.name, () => {
    it('has 256 random bits', () => {
      const counts = []
      for (let i = 0; i < 256; i++) {
        counts.push([0, 0])
      }
      for (let j = 0; j < 32; j++) {
        let rand = randU256Method()
        for (let i = 0; i < 256; i++) {
          counts[i][Number(rand & 1n)]++
          rand >>= 1n
        }
        assert.equal(rand, 0n)
      }
      // this test can fail probabilistically but the probability is low
      // each bit should be independent with 50% likelihood
      // the probability of getting the same bitvalue N times is 2**(1-N)
      // so if this test fails, the 50% assumption is likely wrong
      for (let i = 0; i < 256; i++) {
        assert.isAtLeast(counts[i][0], 1)
        assert.isAtLeast(counts[i][1], 1)
      }
    })
  })
})
