import { isSynapseError, SynapseError } from './base.ts'

export class InsufficientBalanceError extends SynapseError {
  override name: 'InsufficientBalanceError' = 'InsufficientBalanceError'

  constructor(balance: bigint, required: bigint) {
    super(`Insufficient balance.`, {
      details: `Balance: ${balance}, Required: ${required}`,
    })
  }

  static override is(value: unknown): value is InsufficientBalanceError {
    return isSynapseError(value) && value.name === 'InsufficientBalanceError'
  }
}
export class InsufficientAllowanceError extends SynapseError {
  override name: 'InsufficientAllowanceError' = 'InsufficientAllowanceError'

  constructor(allowance: bigint, required: bigint) {
    super(`Insufficient allowance.`, {
      details: `Allowance: ${allowance}, Required: ${required}`,
    })
  }

  static override is(value: unknown): value is InsufficientAllowanceError {
    return isSynapseError(value) && value.name === 'InsufficientAllowanceError'
  }
}

export class DepositAmountError extends SynapseError {
  override name: 'DepositAmountError' = 'DepositAmountError'

  constructor(amount: bigint) {
    super(`Deposit amount must be greater than 0.`, {
      details: `Amount: ${amount}`,
    })
  }

  static override is(value: unknown): value is DepositAmountError {
    return isSynapseError(value) && value.name === 'DepositAmountError'
  }
}

export class WithdrawAmountError extends SynapseError {
  override name: 'WithdrawAmountError' = 'WithdrawAmountError'

  constructor(amount: bigint) {
    super(`Withdraw amount must be greater than 0.`, {
      details: `Amount: ${amount}`,
    })
  }

  static override is(value: unknown): value is WithdrawAmountError {
    return isSynapseError(value) && value.name === 'WithdrawAmountError'
  }
}

export class InsufficientAvailableFundsError extends SynapseError {
  override name: 'InsufficientAvailableFundsError' = 'InsufficientAvailableFundsError'

  constructor(availableFunds: bigint, required: bigint) {
    super(`Insufficient available funds.`, {
      details: `Available funds: ${availableFunds}, Required: ${required}`,
    })
  }

  static override is(value: unknown): value is InsufficientAvailableFundsError {
    return isSynapseError(value) && value.name === 'InsufficientAvailableFundsError'
  }
}
