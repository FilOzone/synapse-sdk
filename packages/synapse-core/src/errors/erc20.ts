import { isSynapseError, SynapseError } from './base.ts'

export class AllowanceAmountError extends SynapseError {
  override name: 'AllowanceAmountError' = 'AllowanceAmountError'

  constructor(amount: bigint) {
    super(`Allowance amount must be positive.`, {
      details: `Amount: ${amount}`,
    })
  }

  static override is(value: unknown): value is AllowanceAmountError {
    return isSynapseError(value) && value.name === 'AllowanceAmountError'
  }
}
