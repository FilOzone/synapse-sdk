/**
 * PaymentsService - Consolidated interface for all Payments contract operations
 * along with some additional token related utilities.
 */

import { ethers } from 'ethers'
import type { TokenAmount, TokenIdentifier, FilecoinNetworkType } from '../types.js'
import { createError, CONTRACT_ADDRESSES, CONTRACT_ABIS, TOKENS, TIMING_CONSTANTS, getCurrentEpoch } from '../utils/index.js'

/**
 * Callbacks for deposit operation visibility
 */
export interface DepositCallbacks {
  /** Called when checking current allowance */
  onAllowanceCheck?: (current: bigint, required: bigint) => void
  /** Called when approval transaction is sent */
  onApprovalTransaction?: (tx: ethers.TransactionResponse) => void
  /** Called when approval is confirmed */
  onApprovalConfirmed?: (receipt: ethers.TransactionReceipt) => void
  /** Called before deposit transaction is sent */
  onDepositStarting?: () => void
}

export class PaymentsService {
  private readonly _provider: ethers.Provider
  private readonly _signer: ethers.Signer
  private readonly _network: FilecoinNetworkType
  private readonly _disableNonceManager: boolean
  // Cached contract instances
  private _usdfcContract: ethers.Contract | null = null
  private _paymentsContract: ethers.Contract | null = null

  constructor (
    provider: ethers.Provider,
    signer: ethers.Signer,
    network: FilecoinNetworkType,
    disableNonceManager: boolean
  ) {
    this._provider = provider
    this._signer = signer
    this._network = network
    this._disableNonceManager = disableNonceManager
  }

  /**
   * Get cached USDFC contract instance or create new one
   */
  private _getUsdfcContract (): ethers.Contract {
    if (this._usdfcContract == null) {
      const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
      if (usdfcAddress == null) {
        throw new Error(`USDFC contract not deployed on ${this._network} network`)
      }
      this._usdfcContract = new ethers.Contract(usdfcAddress, CONTRACT_ABIS.ERC20, this._signer)
    }
    return this._usdfcContract
  }

  /**
   * Get cached payments contract instance or create new one
   */
  private _getPaymentsContract (): ethers.Contract {
    if (this._paymentsContract == null) {
      const paymentsAddress = CONTRACT_ADDRESSES.PAYMENTS[this._network]
      if (paymentsAddress == null || paymentsAddress === '') {
        throw new Error(`Payments contract not deployed on ${this._network} network. Currently only Calibration testnet is supported.`)
      }
      this._paymentsContract = new ethers.Contract(paymentsAddress, CONTRACT_ABIS.PAYMENTS, this._signer)
    }
    return this._paymentsContract
  }

  async balance (token: TokenIdentifier = TOKENS.USDFC): Promise<bigint> {
    // For now, only support USDFC balance
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'payments contract balance check',
        `Token "${token}" is not supported. Currently only USDFC token is supported for payments contract balance queries.`
      )
    }

    const accountInfo = await this.accountInfo(token)
    return accountInfo.availableFunds
  }

  /**
   * Get detailed account information from the payments contract
   * @param token - The token to get account info for (defaults to USDFC)
   * @returns Account information including funds, lockup details, and available balance
   */
  async accountInfo (token: TokenIdentifier = TOKENS.USDFC): Promise<{
    funds: bigint
    lockupCurrent: bigint
    lockupRate: bigint
    lockupLastSettledAt: bigint
    availableFunds: bigint
  }> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'account info',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    const signerAddress = await this._signer.getAddress()
    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const paymentsContract = this._getPaymentsContract()

    let accountData: any[]

    try {
      // Get account info from payments contract
      accountData = await paymentsContract.accounts(usdfcAddress, signerAddress)
    } catch (contractCallError) {
      throw createError(
        'PaymentsService',
        'account info',
        'Failed to read account information from payments contract. This could indicate the contract is not properly deployed, the ABI is incorrect, or there are network connectivity issues.',
        contractCallError
      )
    }

    // accountData returns: (uint256 funds, uint256 lockupCurrent, uint256 lockupRate, uint256 lockupLastSettledAt)
    const [funds, lockupCurrent, lockupRate, lockupLastSettledAt] = accountData

    // Calculate time-based lockup
    const currentEpoch = await getCurrentEpoch(this._provider)
    const epochsSinceSettlement = currentEpoch - BigInt(lockupLastSettledAt)
    const actualLockup = BigInt(lockupCurrent) + (BigInt(lockupRate) * epochsSinceSettlement)

    // Calculate available funds
    const availableFunds = BigInt(funds) - actualLockup

    return {
      funds: BigInt(funds),
      lockupCurrent: BigInt(lockupCurrent),
      lockupRate: BigInt(lockupRate),
      lockupLastSettledAt: BigInt(lockupLastSettledAt),
      availableFunds: availableFunds > 0n ? availableFunds : 0n
    }
  }

  async walletBalance (token?: TokenIdentifier): Promise<bigint> {
    // If no token specified or FIL is requested, return native wallet balance
    if (token == null || token === TOKENS.FIL) {
      try {
        const address = await this._signer.getAddress()
        const balance = await this._provider.getBalance(address)
        return balance
      } catch (error) {
        throw createError(
          'PaymentsService',
          'wallet FIL balance check',
          'Unable to retrieve FIL balance from wallet. This could be due to network connectivity issues, RPC endpoint problems, or wallet connection issues.',
          error
        )
      }
    }

    // Handle ERC20 token balance
    if (token === TOKENS.USDFC) {
      try {
        const address = await this._signer.getAddress()
        const usdfcContract = this._getUsdfcContract()
        const balance = await usdfcContract.balanceOf(address)
        return balance
      } catch (error) {
        throw createError(
          'PaymentsService',
          'wallet USDFC balance check',
          'Unexpected error while checking USDFC token balance in wallet.',
          error
        )
      }
    }

    // For other tokens, could add support later
    throw createError(
      'PaymentsService',
      'wallet balance check',
      `Token "${token}" is not supported. Currently only USDFC token is supported for balance queries.`
    )
  }

  decimals (token: TokenIdentifier = TOKENS.USDFC): number {
    // Both FIL and USDFC use 18 decimals
    return 18
  }

  /**
   * Check the current ERC20 token allowance for a spender
   * @param token - The token to check allowance for (currently only USDFC supported)
   * @param spender - The address to check allowance for
   * @returns The current allowance amount as bigint
   */
  async allowance (token: TokenIdentifier, spender: string): Promise<bigint> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'allowance', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const signerAddress = await this._signer.getAddress()
    const usdfcContract = this._getUsdfcContract()

    try {
      const currentAllowance = await usdfcContract.allowance(signerAddress, spender)
      return currentAllowance
    } catch (error) {
      throw createError(
        'PaymentsService',
        'allowance check',
        'Failed to check token allowance. This could indicate network connectivity issues or an invalid spender address.',
        error
      )
    }
  }

  /**
   * Approve an ERC20 token spender
   * @param token - The token to approve spending for (currently only USDFC supported)
   * @param spender - The address to approve as spender
   * @param amount - The amount to approve
   * @returns Transaction response object
   */
  async approve (token: TokenIdentifier, spender: string, amount: TokenAmount): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'approve', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const approveAmount = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (approveAmount < 0n) {
      throw createError('PaymentsService', 'approve', 'Approval amount cannot be negative')
    }

    const signerAddress = await this._signer.getAddress()
    const usdfcContract = this._getUsdfcContract()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const approvalNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = approvalNonce
    }

    try {
      const approveTx = await usdfcContract.approve(spender, approveAmount, txOptions)
      return approveTx
    } catch (error) {
      throw createError(
        'PaymentsService',
        'approve',
        `Failed to approve ${spender} to spend ${approveAmount.toString()} ${token}`,
        error
      )
    }
  }

  /**
   * Approve a service contract to act as an operator for payment rails
   * This allows the service contract (such as Warm Storage) to create and manage payment rails on behalf
   * of the client
   * @param service - The service contract address to approve
   * @param rateAllowance - Maximum payment rate per epoch the operator can set
   * @param lockupAllowance - Maximum lockup amount the operator can set
   * @param maxLockupPeriod - Maximum lockup period in epochs the operator can set
   * @param token - The token to approve for (defaults to USDFC)
   * @returns Transaction response object
   */
  async approveService (
    service: string,
    rateAllowance: TokenAmount,
    lockupAllowance: TokenAmount,
    maxLockupPeriod: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC
  ): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'approveService', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const rateAllowanceBigint = typeof rateAllowance === 'bigint' ? rateAllowance : BigInt(rateAllowance)
    const lockupAllowanceBigint = typeof lockupAllowance === 'bigint' ? lockupAllowance : BigInt(lockupAllowance)
    const maxLockupPeriodBigint = typeof maxLockupPeriod === 'bigint' ? maxLockupPeriod : BigInt(maxLockupPeriod)

    if (rateAllowanceBigint < 0n || lockupAllowanceBigint < 0n || maxLockupPeriodBigint < 0n) {
      throw createError('PaymentsService', 'approveService', 'Allowance values cannot be negative')
    }

    const signerAddress = await this._signer.getAddress()
    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const paymentsContract = this._getPaymentsContract()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const approveTx = await paymentsContract.setOperatorApproval(
        usdfcAddress,
        service,
        true, // approved
        rateAllowanceBigint,
        lockupAllowanceBigint,
        maxLockupPeriodBigint,
        txOptions
      )
      return approveTx
    } catch (error) {
      throw createError(
        'PaymentsService',
        'approveService',
        `Failed to approve service ${service} as operator for ${token}`,
        error
      )
    }
  }

  /**
   * Revoke a service contract's operator approval
   * @param service - The service contract address to revoke
   * @param token - The token to revoke approval for (defaults to USDFC)
   * @returns Transaction response object
   */
  async revokeService (service: string, token: TokenIdentifier = TOKENS.USDFC): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'revokeService', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const signerAddress = await this._signer.getAddress()
    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const paymentsContract = this._getPaymentsContract()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const revokeTx = await paymentsContract.setOperatorApproval(
        usdfcAddress,
        service,
        false, // not approved
        0n, // zero rate allowance
        0n, // zero lockup allowance
        0n, // zero max lockup period
        txOptions
      )
      return revokeTx
    } catch (error) {
      throw createError(
        'PaymentsService',
        'revokeService',
        `Failed to revoke service ${service} as operator for ${token}`,
        error
      )
    }
  }

  /**
   * Get the operator approval status and allowances for a service
   * @param service - The service contract address to check
   * @param token - The token to check approval for (defaults to USDFC)
   * @returns Approval status and allowances
   */
  async serviceApproval (service: string, token: TokenIdentifier = TOKENS.USDFC): Promise<{
    isApproved: boolean
    rateAllowance: bigint
    rateUsed: bigint
    lockupAllowance: bigint
    lockupUsed: bigint
    maxLockupPeriod: bigint
  }> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'serviceApproval', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const signerAddress = await this._signer.getAddress()
    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const paymentsContract = this._getPaymentsContract()

    try {
      const approval = await paymentsContract.operatorApprovals(usdfcAddress, signerAddress, service)
      return {
        isApproved: approval[0],
        rateAllowance: approval[1],
        lockupAllowance: approval[2],
        rateUsed: approval[3],
        lockupUsed: approval[4],
        maxLockupPeriod: approval[5]
      }
    } catch (error) {
      throw createError(
        'PaymentsService',
        'serviceApproval',
        `Failed to check service approval status for ${service}`,
        error
      )
    }
  }

  async deposit (amount: TokenAmount, token: TokenIdentifier = TOKENS.USDFC, callbacks?: DepositCallbacks): Promise<ethers.TransactionResponse> {
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'deposit', `Unsupported token: ${token}`)
    }

    const depositAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (depositAmountBigint <= 0n) {
      throw createError('PaymentsService', 'deposit', 'Invalid amount')
    }

    const signerAddress = await this._signer.getAddress()

    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const usdfcContract = this._getUsdfcContract()
    const paymentsContract = this._getPaymentsContract()

    // Check balance
    const usdfcBalance = await usdfcContract.balanceOf(signerAddress)

    if (usdfcBalance < depositAmountBigint) {
      throw createError(
        'PaymentsService',
        'deposit',
        `Insufficient USDFC: have ${BigInt(
          usdfcBalance
        ).toString()}, need ${depositAmountBigint.toString()}`
      )
    }

    // Check and update allowance if needed
    const paymentsAddress = CONTRACT_ADDRESSES.PAYMENTS[this._network]
    if (paymentsAddress == null) {
      throw createError('PaymentsService', 'deposit', `Payments contract not deployed on ${this._network}`)
    }

    const currentAllowance = await this.allowance(token, paymentsAddress)
    callbacks?.onAllowanceCheck?.(currentAllowance, depositAmountBigint)

    if (currentAllowance < depositAmountBigint) {
      // Golden path: automatically approve the exact amount needed
      const approveTx = await this.approve(token, paymentsAddress, depositAmountBigint)
      callbacks?.onApprovalTransaction?.(approveTx)

      // Wait for approval to be mined before proceeding
      const approvalReceipt = await approveTx.wait(TIMING_CONSTANTS.TRANSACTION_CONFIRMATIONS)
      if (approvalReceipt != null) {
        callbacks?.onApprovalConfirmed?.(approvalReceipt)
      }
    }

    // Check if account has sufficient available balance (no frozen account check needed for deposits)

    // Notify that deposit is starting
    callbacks?.onDepositStarting?.()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    const depositTx = await paymentsContract.deposit(
      usdfcAddress,
      signerAddress,
      depositAmountBigint,
      txOptions
    )

    return depositTx
  }

  async withdraw (amount: TokenAmount, token: TokenIdentifier = TOKENS.USDFC): Promise<ethers.TransactionResponse> {
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'withdraw', `Unsupported token: ${token}`)
    }

    const withdrawAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)

    if (withdrawAmountBigint <= 0n) {
      throw createError('PaymentsService', 'withdraw', 'Invalid amount')
    }

    const signerAddress = await this._signer.getAddress()

    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const paymentsContract = this._getPaymentsContract()

    // Check balance using the corrected accountInfo method
    const accountInfo = await this.accountInfo(token)

    if (accountInfo.availableFunds < withdrawAmountBigint) {
      throw createError(
        'PaymentsService',
        'withdraw',
        `Insufficient available balance: have ${accountInfo.availableFunds.toString()}, need ${withdrawAmountBigint.toString()}`
      )
    }

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    const withdrawTx = await paymentsContract.withdraw(usdfcAddress, withdrawAmountBigint, txOptions)

    return withdrawTx
  }
}
