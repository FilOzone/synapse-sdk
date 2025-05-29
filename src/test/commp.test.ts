/* globals describe it */

/**
 * Basic tests for CommP utilities
 */

import { assert } from 'chai'
import { CID } from 'multiformats/cid'
import { asCommP } from '../commp.js'

describe('CommP utilities', () => {
  const validCommPString = 'baga6ea4seaqjtovkwk4myyzj56eztkh5pzsk5upksan6f5outesy62bsvl4dsha'
  const invalidCidString = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' // CIDv0, not CommP

  describe('asCommP', () => {
    it('should accept valid CommP string', () => {
      const result = asCommP(validCommPString)
      assert.isNotNull(result)
      assert.strictEqual(result?.toString(), validCommPString)
    })

    it('should accept CommP CID object', () => {
      const cid = CID.parse(validCommPString)
      const result = asCommP(cid)
      assert.isNotNull(result)
      assert.strictEqual(result?.toString(), validCommPString)
    })

    it('should return null for invalid CommP string', () => {
      const result = asCommP(invalidCidString)
      assert.isNull(result)
    })

    it('should return null for invalid CID object', () => {
      const invalidCid = CID.parse(invalidCidString)
      const result = asCommP(invalidCid)
      assert.isNull(result)
    })

    it('should return null for malformed string', () => {
      const result = asCommP('not-a-cid')
      assert.isNull(result)
    })
  })

  describe('edge cases', () => {
    it('should return null for null input', () => {
      const result = asCommP(null as any)
      assert.isNull(result)
    })

    it('should return null for undefined input', () => {
      const result = asCommP(undefined as any)
      assert.isNull(result)
    })

    it('should return null for number input', () => {
      const result = asCommP(123 as any)
      assert.isNull(result)
    })

    it('should return null for object that is not a CID', () => {
      const result = asCommP({} as any)
      assert.isNull(result)
    })
  })
})
