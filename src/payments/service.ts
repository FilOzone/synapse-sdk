/**
 * PaymentsService - Consolidated interface for all Payments contract operations
 * along with some additional token related utilities.
 */

import { ethers } from 'ethers'
import type { TokenAmount, TokenIdentifier, FilecoinNetworkType, PermitData, SignedPermit, PermitContext, PermitDepositCallbacks } from '../types.js'
import { createError, CONTRACT_ADDRESSES, CONTRACT_ABIS, TOKENS, TIMING_CONSTANTS, getUnderlyingSigner } from '../utils/index.js'

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
  private readonly _paymentsAddress: string
  // Cached contract instances
  private _usdfcContract: ethers.Contract | null = null
  private _paymentsContract: ethers.Contract | null = null

  constructor (
    provider: ethers.Provider,
    signer: ethers.Signer,
    network: FilecoinNetworkType,
    disableNonceManager: boolean,
    paymentsAddress: string
  ) {
    this._provider = provider
    this._signer = signer
    this._network = network
    this._disableNonceManager = disableNonceManager
    this._paymentsAddress = paymentsAddress
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
      this._paymentsContract = new ethers.Contract(this._paymentsAddress, CONTRACT_ABIS.PAYMENTS, this._signer)
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
    const currentEpoch = await this.getCurrentEpoch()
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

  /**
   * Get the current epoch from the blockchain
   */
  async getCurrentEpoch (): Promise<bigint> {
    const block = await this._provider.getBlock('latest')
    if (block == null) {
      throw createError('PaymentsService', 'getCurrentEpoch', 'Failed to get latest block')
    }
    // In Filecoin, the block number is the epoch
    return BigInt(block.number)
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
   *
   * Note: When using depositWithPermit(), allowance checks are not needed
   * as the permit signature handles approval.
   *
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
   *
   * Note: When using depositWithPermit(), explicit approval is not needed
   * as the permit signature handles approval in the same transaction.
   *
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
   * This allows the service contract (such as Pandora) to create and manage payment rails on behalf
   * of the client
   * @param service - The service contract address to approve
   * @param rateAllowance - Maximum payment rate per epoch the operator can set
   * @param lockupAllowance - Maximum lockup amount the operator can set
   * @param token - The token to approve for (defaults to USDFC)
   * @returns Transaction response object
   */
  async approveService (
    service: string,
    rateAllowance: TokenAmount,
    lockupAllowance: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC
  ): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'approveService', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const rateAllowanceBigint = typeof rateAllowance === 'bigint' ? rateAllowance : BigInt(rateAllowance)
    const lockupAllowanceBigint = typeof lockupAllowance === 'bigint' ? lockupAllowance : BigInt(lockupAllowance)

    if (rateAllowanceBigint < 0n || lockupAllowanceBigint < 0n) {
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
        lockupUsed: approval[4]
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

  /**
   * Deposit tokens using traditional approve + deposit flow
   *
   * This method uses the traditional two-transaction flow:
   * 1. Approve the Payments contract to spend your tokens (if needed)
   * 2. Deposit the tokens to the Payments contract
   *
   * For a better user experience with USDFC tokens that support EIP-2612,
   * use `depositWithPermit()` which combines both operations into a single transaction.
   *
   * @param amount - Amount to deposit
   * @param token - Token identifier (defaults to USDFC)
   * @param callbacks - Optional callbacks for operation visibility
   * @returns Transaction response
   * @see depositWithPermit for single-transaction deposits with EIP-2612 tokens
   */
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

  /**
   * Generate permit data for EIP-2612 token approval
   * @param amount - Amount to permit for spending
   * @param token - Token identifier (defaults to USDFC)
   * @param deadlineMinutes - Minutes until permit expires (default: 30)
   * @returns Rich context with permit data, domain, and types
   * @private
   */
  private async _generatePermit (
    amount: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC,
    deadlineMinutes: number = 30
  ): Promise<PermitContext> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'generatePermit', `Token "${token}" is not supported. Currently only USDFC token supports permits.`)
    }

    const amountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (amountBigint <= 0n) {
      throw createError('PaymentsService', 'generatePermit', 'Permit amount must be positive')
    }

    const signerAddress = await this._signer.getAddress()
    const paymentsAddress = this._paymentsAddress

    const usdfcContract = this._getUsdfcContract()

    // Get current nonce for the owner
    let nonce: bigint
    try {
      nonce = await usdfcContract.nonces(signerAddress)
    } catch (error) {
      throw createError(
        'PaymentsService',
        'generatePermit',
        'Failed to get permit nonce from USDFC contract. The token might not support EIP-2612 permits.',
        error
      )
    }

    // Calculate deadline (current time + deadlineMinutes)
    const currentTime = Math.floor(Date.now() / 1000)
    const deadline = BigInt(currentTime + (deadlineMinutes * 60))

    // Get chain ID
    const network = await this._provider.getNetwork()
    const chainId = Number(network.chainId)

    // Get token name for domain
    let tokenName: string
    try {
      tokenName = await usdfcContract.name()
    } catch {
      // Fallback if name() is not available
      tokenName = 'USDFC'
    }

    // Construct EIP-712 domain
    const domain: ethers.TypedDataDomain = {
      name: tokenName,
      version: '1',
      chainId,
      verifyingContract: CONTRACT_ADDRESSES.USDFC[this._network]
    }

    // EIP-712 types for permit
    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
      ]
    }

    const permitData: PermitData = {
      owner: signerAddress,
      spender: paymentsAddress,
      value: amountBigint,
      deadline,
      nonce
    }

    // Format deadline for display
    const deadlineDate = new Date(Number(deadline) * 1000)
    const formattedAmount = (amountBigint / BigInt(10 ** 18)).toString()

    return {
      permitData,
      domain,
      types,
      message: `Approve ${formattedAmount} USDFC spending for Synapse Payments until ${deadlineDate.toLocaleString()}`
    }
  }

  /**
   * Sign permit data using EIP-712
   * @param permitContext - Context returned from generatePermit
   * @returns Signed permit ready for on-chain submission
   * @private
   */
  private async _signPermit (permitContext: PermitContext): Promise<SignedPermit> {
    const { permitData, domain, types } = permitContext

    // Get the underlying signer (unwrap NonceManager if needed)
    const signer = getUnderlyingSigner(this._signer)

    try {
      // Sign the permit using EIP-712
      const signature = await signer.signTypedData(
        domain,
        types,
        {
          owner: permitData.owner,
          spender: permitData.spender,
          value: permitData.value,
          nonce: permitData.nonce,
          deadline: permitData.deadline
        }
      )

      // Split signature into r, s, v
      const sig = ethers.Signature.from(signature)

      return {
        ...permitData,
        v: sig.v,
        r: sig.r,
        s: sig.s
      }
    } catch (error) {
      // Check for common rejection errors
      const errorObj = error as any
      if (errorObj.code === 'ACTION_REJECTED' || errorObj.message?.includes('rejected') === true) {
        throw createError(
          'PaymentsService',
          'signPermit',
          'User rejected the permit signature request'
        )
      }
      throw createError(
        'PaymentsService',
        'signPermit',
        'Failed to sign permit. This could be due to wallet issues or user rejection.',
        error
      )
    }
  }

  /**
   * Execute deposit using a signed permit (no prior approval needed)
   * @param amount - Amount to deposit
   * @param signedPermit - Signed permit data
   * @param token - Token identifier (defaults to USDFC)
   * @param callbacks - Optional callbacks for operation visibility
   * @returns Transaction response
   * @private
   */
  private async _executeDepositWithPermit (
    amount: TokenAmount,
    signedPermit: SignedPermit,
    token: TokenIdentifier = TOKENS.USDFC,
    callbacks?: PermitDepositCallbacks
  ): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'depositWithPermit', `Token "${token}" is not supported.`)
    }

    const depositAmount = typeof amount === 'bigint' ? amount : BigInt(amount)

    // Validate amount matches permit
    if (depositAmount > signedPermit.value) {
      throw createError(
        'PaymentsService',
        'depositWithPermit',
        `Deposit amount (${depositAmount}) exceeds permit value (${signedPermit.value})`
      )
    }

    // Validate deadline hasn't passed
    const currentTime = BigInt(Math.floor(Date.now() / 1000))
    if (currentTime > signedPermit.deadline) {
      const expiredDate = new Date(Number(signedPermit.deadline) * 1000)
      throw createError(
        'PaymentsService',
        'depositWithPermit',
        `Permit expired at ${expiredDate.toLocaleString()}`
      )
    }

    const signerAddress = await this._signer.getAddress()
    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const paymentsContract = this._getPaymentsContract()

    // Check wallet balance
    const usdfcContract = this._getUsdfcContract()
    const balance = await usdfcContract.balanceOf(signerAddress)

    if (balance < depositAmount) {
      throw createError(
        'PaymentsService',
        'depositWithPermit',
        `Insufficient USDFC: have ${String(balance)}, need ${depositAmount.toString()}`
      )
    }

    callbacks?.onDepositStarting?.()

    // Transaction options
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const depositTx = await paymentsContract.depositWithPermit(
        usdfcAddress,
        signerAddress,
        depositAmount,
        signedPermit.deadline,
        signedPermit.v,
        signedPermit.r,
        signedPermit.s,
        txOptions
      )

      return depositTx
    } catch (error) {
      // Check for specific error conditions
      const errorObj = error as any
      const errorMessage = errorObj.message as string | undefined
      if (errorMessage?.includes('expired') === true) {
        throw createError(
          'PaymentsService',
          'depositWithPermit',
          'Permit signature has expired. Please generate a new permit.',
          error
        )
      }
      if (errorMessage?.includes('invalid') === true || errorMessage?.includes('signature') === true) {
        throw createError(
          'PaymentsService',
          'depositWithPermit',
          'Invalid permit signature. The signature may be malformed or not match the permit data.',
          error
        )
      }
      throw createError(
        'PaymentsService',
        'depositWithPermit',
        'Failed to execute deposit with permit',
        error
      )
    }
  }

  /**
   * Deposit tokens using EIP-2612 permit for gasless approval
   *
   * This is the recommended way to deposit USDFC tokens. It executes the
   * deposit in a single transaction using permit signatures.
   *
   * @param amount - Amount to deposit
   * @param token - Token identifier (defaults to USDFC)
   * @param options - Optional parameters including callbacks and deadline
   * @returns Transaction response
   *
   * @example
   * ```typescript
   * // Simple deposit
   * const tx = await payments.depositWithPermit(parseUnits('100', 18))
   * await tx.wait()
   *
   * // With callbacks for UI updates
   * const tx = await payments.depositWithPermit(amount, TOKENS.USDFC, {
   *   callbacks: {
   *     onPermitSigning: () => console.log('Signing permit...'),
   *     onDepositStarting: () => console.log('Sending transaction...')
   *   }
   * })
   * ```
   */
  async depositWithPermit (
    amount: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC,
    options?: {
      deadlineMinutes?: number
      callbacks?: PermitDepositCallbacks
    }
  ): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'depositWithPermit', `Token "${token}" is not supported. Currently only USDFC supports permits.`)
    }

    const deadlineMinutes = options?.deadlineMinutes ?? 30
    const callbacks = options?.callbacks

    // Generate permit
    const permitContext = await this._generatePermit(amount, token, deadlineMinutes)

    // Sign permit
    callbacks?.onPermitSigning?.()
    const signedPermit = await this._signPermit(permitContext)

    // Execute the deposit with the signed permit
    const tx = await this._executeDepositWithPermit(amount, signedPermit, token, callbacks)

    return tx
  }
}
