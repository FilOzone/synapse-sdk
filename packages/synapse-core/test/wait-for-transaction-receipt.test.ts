import { assert } from 'chai'
import { InternalRpcError, RpcRequestError, UnknownRpcError } from 'viem'
import { isNullRoundError } from '../src/utils/wait-for-transaction-receipt.ts'

function rpcError(code: number, message: string) {
  return new RpcRequestError({ body: {}, error: { code, message }, url: 'http://localhost' })
}

describe('isNullRoundError', () => {
  it('detects the Lotus null round error, wrapped like viem does', () => {
    assert.isTrue(isNullRoundError(new UnknownRpcError(rpcError(12, 'requested epoch was a null round (280)'))))
  })

  it('detects a null round message under another code', () => {
    assert.isTrue(isNullRoundError(new InternalRpcError(rpcError(-32603, 'requested epoch was a null round (298)'))))
  })

  it('ignores other errors', () => {
    assert.isFalse(isNullRoundError(new InternalRpcError(rpcError(-32603, 'internal error'))))
    assert.isFalse(isNullRoundError(new Error('null round')))
    assert.isFalse(isNullRoundError(undefined))
  })
})
