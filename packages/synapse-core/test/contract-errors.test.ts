import assert from 'assert'
import { BaseError, getAddress } from 'viem'
import { isViemError, STRING_ERRORS, stringErrorEquals } from '../src/utils/contract-errors.ts'

describe('isViemError', () => {
  it('should detect a real viem-thrown error', () => {
    try {
      getAddress('not-an-address')
      assert.fail('Expected viem to throw')
    } catch (error) {
      assert.equal(isViemError(error), true)

      if (!isViemError(error)) {
        assert.fail('Expected a viem BaseError')
      }

      assert.equal(typeof error.shortMessage, 'string')
      assert.match(error.message, /Version: viem@/)
    }
  })
})

describe('stringErrorEquals', () => {
  it('should match the viem revert reason from a nested cause chain', () => {
    const rootCause = new Error('execution reverted') as Error & { reason: string }
    rootCause.reason = STRING_ERRORS.PDP_VERIFIER_DATA_SET_NOT_LIVE
    const nestedCause = new BaseError('Call execution failed', { cause: rootCause })
    const error = new BaseError('Contract call failed', { cause: nestedCause })

    assert.equal(stringErrorEquals(error, STRING_ERRORS.PDP_VERIFIER_DATA_SET_NOT_LIVE), true)
  })

  it('should match the viem revert reason from the error message', () => {
    const error = new BaseError('Contract call failed', {
      details: 'vm error=[Error(Data set not live)]',
    })

    assert.equal(stringErrorEquals(error, STRING_ERRORS.PDP_VERIFIER_DATA_SET_NOT_LIVE), true)
  })
})
