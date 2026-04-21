import assert from 'assert'
import { BaseError, getAddress } from 'viem'
import { isProviderExistsRevert, isViemError, STRING_ERRORS, stringErrorEquals } from '../src/utils/contract-errors.ts'

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

describe('isProviderExistsRevert', () => {
  it('should match "Provider does not exist"', () => {
    const rootCause = new Error('execution reverted') as Error & { reason: string }
    rootCause.reason = STRING_ERRORS.SP_REGISTRY_PROVIDER_DOES_NOT_EXIST
    const error = new BaseError('Contract call failed', { cause: rootCause })

    assert.equal(isProviderExistsRevert(error), true)
  })

  it('should match "Provider not found"', () => {
    const rootCause = new Error('execution reverted') as Error & { reason: string }
    rootCause.reason = STRING_ERRORS.SP_REGISTRY_PROVIDER_NOT_FOUND
    const error = new BaseError('Contract call failed', { cause: rootCause })

    assert.equal(isProviderExistsRevert(error), true)
  })

  it('should match from the error message regex', () => {
    const error = new BaseError('Contract call failed', {
      details: 'vm error=[Error(Provider does not exist)]',
    })

    assert.equal(isProviderExistsRevert(error), true)
  })

  it('should not match other revert reasons', () => {
    const rootCause = new Error('execution reverted') as Error & { reason: string }
    rootCause.reason = STRING_ERRORS.PDP_VERIFIER_DATA_SET_NOT_LIVE
    const error = new BaseError('Contract call failed', { cause: rootCause })

    assert.equal(isProviderExistsRevert(error), false)
  })

  it('should not match non-viem errors', () => {
    assert.equal(isProviderExistsRevert(new Error('Provider not found')), false)
    assert.equal(isProviderExistsRevert('Provider not found'), false)
    assert.equal(isProviderExistsRevert(null), false)
  })
})
