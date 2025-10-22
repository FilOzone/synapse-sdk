/**
 * PaymentsService - Consolidated interface for all Payments contract operations
 * along with some additional token related utilities.
 */

import { ethers } from 'ethers'
import type { RailInfo, SettlementResult, TokenAmount, TokenIdentifier } from '../types.ts'
import {
  CHAIN_IDS,
  CONTRACT_ABIS,
  CONTRACT_ADDRESSES,
  createError,
  EIP2612_PERMIT_TYPES,
  getCurrentEpoch,
  getFilecoinNetworkType,
  SETTLEMENT_FEE,
  TIMING_CONSTANTS,
  TOKENS,
} from '../utils/index.ts'

/**
 * Options for deposit operation
 */
export interface DepositOptions {
  /** Optional recipient address (defaults to signer address if not provided) */
  to?: string
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
  private readonly _paymentsAddress: string
  private readonly _usdfcAddress: string
  private readonly _disableNonceManager: boolean
  // Cached contract instances
  private _usdfcContract: ethers.Contract | null = null
  private _paymentsContract: ethers.Contract | null = null

  /**
   * @param provider - Direct provider instance for balance checks, nonce management, and epoch calculations
   * @param signer - Signer instance for transaction signing (may be wrapped in NonceManager)
   * @param paymentsAddress - Address of the Payments contract
   * @param usdfcAddress - Address of the USDFC token contract
   * @param disableNonceManager - When true, manually manages nonces using provider.getTransactionCount()
   *
   * Note: Both provider and signer are required for NonceManager compatibility. When NonceManager
   * is disabled, we need direct provider access for reliable nonce management. Using signer.provider
   * could interfere with NonceManager's internal state or behave differently with MetaMask/hardware wallets.
   */
  constructor(
    provider: ethers.Provider,
    signer: ethers.Signer,
    paymentsAddress: string,
    usdfcAddress: string,
    disableNonceManager: boolean
  ) {
    this._provider = provider
    this._signer = signer
    this._paymentsAddress = paymentsAddress
    this._usdfcAddress = usdfcAddress
    this._disableNonceManager = disableNonceManager
  }

  /**
   * Get cached USDFC contract instance or create new one
   */
  private _getUsdfcContract(): ethers.Contract {
    if (this._usdfcContract == null) {
      this._usdfcContract = new ethers.Contract(this._usdfcAddress, CONTRACT_ABIS.ERC20, this._signer)
    }
    return this._usdfcContract
  }

  /**
   * Get cached payments contract instance or create new one
   */
  private _getPaymentsContract(): ethers.Contract {
    if (this._paymentsContract == null) {
      this._paymentsContract = new ethers.Contract(this._paymentsAddress, CONTRACT_ABIS.PAYMENTS, this._signer)
    }
    return this._paymentsContract
  }

  /**
   * Generate EIP-2612 permit signature for USDFC token
   * Handles balance check, domain creation, nonce retrieval, and signature generation
   * Uses Multicall3 to batch RPC calls for efficiency
   * @param amount - Amount to permit
   * @param deadline - Unix timestamp (seconds) when the permit expires
   * @param contextName - Context name for error messages (e.g., 'depositWithPermit')
   * @returns Signature object
   */
  private async _getPermitSignature(amount: bigint, deadline: bigint, contextName: string): Promise<ethers.Signature> {
    const signerAddress = await this._signer.getAddress()

    // Get network type (validates network and makes single getNetwork() call internally)
    const networkType = await getFilecoinNetworkType(this._provider)

    // Derive chainId from network type
    const chainId = CHAIN_IDS[networkType]

    // Setup Multicall3 for batched RPC calls
    const multicall3Address = CONTRACT_ADDRESSES.MULTICALL3[networkType]
    const multicall = new ethers.Contract(multicall3Address, CONTRACT_ABIS.MULTICALL3, this._provider)

    // Create interfaces for encoding/decoding
    const erc20Interface = new ethers.Interface(CONTRACT_ABIS.ERC20)
    const permitInterface = new ethers.Interface(CONTRACT_ABIS.ERC20_PERMIT)

    // Prepare multicall batch: balanceOf, name, version (with fallback), nonces
    const calls = [
      {
        target: this._usdfcAddress,
        allowFailure: false,
        callData: erc20Interface.encodeFunctionData('balanceOf', [signerAddress]),
      },
      {
        target: this._usdfcAddress,
        allowFailure: false,
        callData: erc20Interface.encodeFunctionData('name'),
      },
      {
        target: this._usdfcAddress,
        allowFailure: true, // Allow failure for version, we'll fallback to '1'
        callData: permitInterface.encodeFunctionData('version'),
      },
      {
        target: this._usdfcAddress,
        allowFailure: false,
        callData: permitInterface.encodeFunctionData('nonces', [signerAddress]),
      },
    ]

    // Execute multicall
    let results: any[]
    try {
      results = await multicall.aggregate3.staticCall(calls)
    } catch (error) {
      throw createError(
        'PaymentsService',
        contextName,
        'Failed to fetch token information for permit. Ensure token contract is reachable.',
        error
      )
    }

    // Decode results
    // Result 0: balanceOf
    let usdfcBalance: bigint
    try {
      const decoded = erc20Interface.decodeFunctionResult('balanceOf', results[0].returnData)
      usdfcBalance = decoded[0]
    } catch (error) {
      throw createError('PaymentsService', contextName, 'Failed to decode token balance.', error)
    }

    // Check balance
    if (usdfcBalance < amount) {
      throw createError(
        'PaymentsService',
        contextName,
        `Insufficient USDFC: have ${usdfcBalance.toString()}, need ${amount.toString()}`
      )
    }

    // Result 1: name
    let tokenName: string
    try {
      const decoded = erc20Interface.decodeFunctionResult('name', results[1].returnData)
      tokenName = decoded[0]
    } catch (error) {
      throw createError(
        'PaymentsService',
        contextName,
        'Failed to read token name for permit domain. Ensure token contract is reachable.',
        error
      )
    }

    // Result 2: version (with fallback)
    let domainVersion = '1'
    if (results[2].success) {
      try {
        const decoded = permitInterface.decodeFunctionResult('version', results[2].returnData)
        const maybeVersion = decoded[0]
        if (typeof maybeVersion === 'string' && maybeVersion.length > 0) {
          domainVersion = maybeVersion
        }
      } catch {
        // silently fallback to '1'
      }
    }

    // Result 3: nonces
    let nonce: bigint
    try {
      const decoded = permitInterface.decodeFunctionResult('nonces', results[3].returnData)
      nonce = decoded[0]
    } catch (error) {
      throw createError(
        'PaymentsService',
        contextName,
        'Token does not appear to support EIP-2612 permit (nonces() unavailable).',
        error
      )
    }

    // Build EIP-2612 permit domain
    const domain = {
      name: tokenName,
      version: domainVersion,
      chainId,
      verifyingContract: this._usdfcAddress,
    }

    // Create permit value
    const value = {
      owner: signerAddress,
      spender: this._paymentsAddress,
      value: amount,
      nonce,
      deadline,
    }

    // Sign typed data
    let signatureHex: string
    try {
      signatureHex = await this._signer.signTypedData(domain, EIP2612_PERMIT_TYPES, value)
    } catch (error) {
      throw createError(
        'PaymentsService',
        contextName,
        'Failed to sign EIP-2612 permit. Ensure your wallet supports typed data signing.',
        error
      )
    }

    return ethers.Signature.from(signatureHex)
  }

  async balance(token: TokenIdentifier = TOKENS.USDFC): Promise<bigint> {
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
  async accountInfo(token: TokenIdentifier = TOKENS.USDFC): Promise<{
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
    const paymentsContract = this._getPaymentsContract()

    let accountData: any[]

    try {
      // Get account info from payments contract
      accountData = await paymentsContract.accounts(this._usdfcAddress, signerAddress)
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
    const actualLockup = BigInt(lockupCurrent) + BigInt(lockupRate) * epochsSinceSettlement

    // Calculate available funds
    const availableFunds = BigInt(funds) - actualLockup

    return {
      funds: BigInt(funds),
      lockupCurrent: BigInt(lockupCurrent),
      lockupRate: BigInt(lockupRate),
      lockupLastSettledAt: BigInt(lockupLastSettledAt),
      availableFunds: availableFunds > 0n ? availableFunds : 0n,
    }
  }

  async walletBalance(token?: TokenIdentifier): Promise<bigint> {
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

    // For other tokens, throw error
    throw createError(
      'PaymentsService',
      'wallet balance',
      `Token "${token}" is not supported. Currently only FIL and USDFC tokens are supported.`
    )
  }

  decimals(_token: TokenIdentifier = TOKENS.USDFC): number {
    // Both FIL and USDFC use 18 decimals
    return 18
  }

  /**
   * Check the current ERC20 token allowance for a spender
   * @param spender - The address to check allowance for
   * @param token - The token to check allowance for (defaults to USDFC)
   * @returns The current allowance amount as bigint
   */
  async allowance(spender: string, token: TokenIdentifier = TOKENS.USDFC): Promise<bigint> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'allowance',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
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
   * @param spender - The address to approve as spender
   * @param amount - The amount to approve
   * @param token - The token to approve spending for (defaults to USDFC)
   * @returns Transaction response object
   */
  async approve(
    spender: string,
    amount: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC
  ): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'approve',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
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
  async approveService(
    service: string,
    rateAllowance: TokenAmount,
    lockupAllowance: TokenAmount,
    maxLockupPeriod: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC
  ): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'approveService',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    const rateAllowanceBigint = typeof rateAllowance === 'bigint' ? rateAllowance : BigInt(rateAllowance)
    const lockupAllowanceBigint = typeof lockupAllowance === 'bigint' ? lockupAllowance : BigInt(lockupAllowance)
    const maxLockupPeriodBigint = typeof maxLockupPeriod === 'bigint' ? maxLockupPeriod : BigInt(maxLockupPeriod)

    if (rateAllowanceBigint < 0n || lockupAllowanceBigint < 0n || maxLockupPeriodBigint < 0n) {
      throw createError('PaymentsService', 'approveService', 'Allowance values cannot be negative')
    }

    const signerAddress = await this._signer.getAddress()
    const paymentsContract = this._getPaymentsContract()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const approveTx = await paymentsContract.setOperatorApproval(
        this._usdfcAddress,
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
  async revokeService(service: string, token: TokenIdentifier = TOKENS.USDFC): Promise<ethers.TransactionResponse> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'revokeService',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    const signerAddress = await this._signer.getAddress()
    const paymentsContract = this._getPaymentsContract()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const revokeTx = await paymentsContract.setOperatorApproval(
        this._usdfcAddress,
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
  async serviceApproval(
    service: string,
    token: TokenIdentifier = TOKENS.USDFC
  ): Promise<{
    isApproved: boolean
    rateAllowance: bigint
    rateUsed: bigint
    lockupAllowance: bigint
    lockupUsed: bigint
    maxLockupPeriod: bigint
  }> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'serviceApproval',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    const signerAddress = await this._signer.getAddress()
    const paymentsContract = this._getPaymentsContract()

    try {
      const approval = await paymentsContract.operatorApprovals(this._usdfcAddress, signerAddress, service)
      return {
        isApproved: approval[0],
        rateAllowance: approval[1],
        lockupAllowance: approval[2],
        rateUsed: approval[3],
        lockupUsed: approval[4],
        maxLockupPeriod: approval[5],
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

  async deposit(
    amount: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC,
    options?: DepositOptions
  ): Promise<ethers.TransactionResponse> {
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'deposit', `Unsupported token: ${token}`)
    }

    const depositAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (depositAmountBigint <= 0n) {
      throw createError('PaymentsService', 'deposit', 'Invalid amount')
    }

    const signerAddress = await this._signer.getAddress()
    const depositTo = options?.to ?? signerAddress
    const usdfcContract = this._getUsdfcContract()
    const paymentsContract = this._getPaymentsContract()

    // Check balance
    const usdfcBalance = await usdfcContract.balanceOf(signerAddress)

    if (usdfcBalance < depositAmountBigint) {
      throw createError(
        'PaymentsService',
        'deposit',
        `Insufficient USDFC: have ${BigInt(usdfcBalance).toString()}, need ${depositAmountBigint.toString()}`
      )
    }

    // Check and update allowance if needed
    const currentAllowance = await this.allowance(this._paymentsAddress, token)
    options?.onAllowanceCheck?.(currentAllowance, depositAmountBigint)

    if (currentAllowance < depositAmountBigint) {
      // Golden path: automatically approve the exact amount needed
      const approveTx = await this.approve(this._paymentsAddress, depositAmountBigint, token)
      options?.onApprovalTransaction?.(approveTx)

      // Wait for approval to be mined before proceeding
      const approvalReceipt = await approveTx.wait(TIMING_CONSTANTS.TRANSACTION_CONFIRMATIONS)
      if (approvalReceipt != null) {
        options?.onApprovalConfirmed?.(approvalReceipt)
      }
    }

    // Check if account has sufficient available balance (no frozen account check needed for deposits)

    // Notify that deposit is starting
    options?.onDepositStarting?.()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    const depositTx = await paymentsContract.deposit(this._usdfcAddress, depositTo, depositAmountBigint, txOptions)

    return depositTx
  }

  /**
   * Deposit funds using ERC-2612 permit to approve and deposit in a single transaction
   * This method creates an EIP-712 typed-data signature for the USDFC token's permit,
   * then calls the Payments contract `depositWithPermit` to pull funds and credit the account.
   *
   * @param amount - Amount of USDFC to deposit (in base units)
   * @param token - Token identifier (currently only USDFC is supported)
   * @param deadline - Unix timestamp (seconds) when the permit expires. Defaults to now + 1 hour.
   * @returns Transaction response object
   */
  async depositWithPermit(
    amount: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC,
    deadline?: number | bigint
  ): Promise<ethers.TransactionResponse> {
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'depositWithPermit', `Unsupported token: ${token}`)
    }

    const depositAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (depositAmountBigint <= 0n) {
      throw createError('PaymentsService', 'depositWithPermit', 'Invalid amount')
    }

    const signerAddress = await this._signer.getAddress()
    const paymentsContract = this._getPaymentsContract()

    // Calculate deadline
    const permitDeadline: bigint =
      deadline == null
        ? BigInt(Math.floor(Date.now() / 1000) + TIMING_CONSTANTS.PERMIT_DEADLINE_DURATION)
        : BigInt(deadline)

    // Get permit signature (includes balance check, domain, nonce, signing)
    const signature = await this._getPermitSignature(depositAmountBigint, permitDeadline, 'depositWithPermit')

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const tx = await paymentsContract.depositWithPermit(
        this._usdfcAddress,
        signerAddress,
        depositAmountBigint,
        permitDeadline,
        signature.v,
        signature.r,
        signature.s,
        txOptions
      )
      return tx
    } catch (error) {
      throw createError(
        'PaymentsService',
        'depositWithPermit',
        'Failed to execute depositWithPermit on Payments contract.',
        error
      )
    }
  }

  /**
   * Deposit funds using ERC-2612 permit and approve an operator in a single transaction
   * This signs an EIP-712 permit for the USDFC token and calls the Payments contract
   * function `depositWithPermitAndApproveOperator` which both deposits and sets operator approval.
   *
   * @param amount - Amount of USDFC to deposit (in base units)
   * @param operator - Service/operator address to approve
   * @param rateAllowance - Max payment rate per epoch operator can set
   * @param lockupAllowance - Max lockup amount operator can set
   * @param maxLockupPeriod - Max lockup period in epochs operator can set
   * @param token - Token identifier (currently only USDFC supported)
   * @param deadline - Unix timestamp (seconds) when the permit expires. Defaults to now + 1 hour.
   * @returns Transaction response object
   */
  async depositWithPermitAndApproveOperator(
    amount: TokenAmount,
    operator: string,
    rateAllowance: TokenAmount,
    lockupAllowance: TokenAmount,
    maxLockupPeriod: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC,
    deadline?: number | bigint
  ): Promise<ethers.TransactionResponse> {
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'depositWithPermitAndApproveOperator', `Unsupported token: ${token}`)
    }

    const depositAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (depositAmountBigint <= 0n) {
      throw createError('PaymentsService', 'depositWithPermitAndApproveOperator', 'Invalid amount')
    }

    const rateAllowanceBigint = typeof rateAllowance === 'bigint' ? rateAllowance : BigInt(rateAllowance)
    const lockupAllowanceBigint = typeof lockupAllowance === 'bigint' ? lockupAllowance : BigInt(lockupAllowance)
    const maxLockupPeriodBigint = typeof maxLockupPeriod === 'bigint' ? maxLockupPeriod : BigInt(maxLockupPeriod)
    if (rateAllowanceBigint < 0n || lockupAllowanceBigint < 0n || maxLockupPeriodBigint < 0n) {
      throw createError('PaymentsService', 'depositWithPermitAndApproveOperator', 'Allowance values cannot be negative')
    }

    const signerAddress = await this._signer.getAddress()
    const paymentsContract = this._getPaymentsContract()

    // Calculate deadline
    const permitDeadline: bigint =
      deadline == null
        ? BigInt(Math.floor(Date.now() / 1000) + TIMING_CONSTANTS.PERMIT_DEADLINE_DURATION)
        : BigInt(deadline)

    // Get permit signature (includes balance check, domain, nonce, signing)
    const signature = await this._getPermitSignature(
      depositAmountBigint,
      permitDeadline,
      'depositWithPermitAndApproveOperator'
    )

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const tx = await paymentsContract.depositWithPermitAndApproveOperator(
        this._usdfcAddress,
        signerAddress,
        depositAmountBigint,
        permitDeadline,
        signature.v,
        signature.r,
        signature.s,
        operator,
        rateAllowanceBigint,
        lockupAllowanceBigint,
        maxLockupPeriodBigint,
        txOptions
      )
      return tx
    } catch (error) {
      throw createError(
        'PaymentsService',
        'depositWithPermitAndApproveOperator',
        'Failed to execute depositWithPermitAndApproveOperator on Payments contract.',
        error
      )
    }
  }

  async withdraw(amount: TokenAmount, token: TokenIdentifier = TOKENS.USDFC): Promise<ethers.TransactionResponse> {
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'withdraw', `Unsupported token: ${token}`)
    }

    const withdrawAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)

    if (withdrawAmountBigint <= 0n) {
      throw createError('PaymentsService', 'withdraw', 'Invalid amount')
    }

    const signerAddress = await this._signer.getAddress()
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

    const tx = await paymentsContract.withdraw(this._usdfcAddress, withdrawAmountBigint, txOptions)

    return tx
  }

  /**
   * Settle a payment rail up to a specific epoch (sends a transaction)
   * Note: This method automatically includes the required network fee (FIL) for burning
   * @param railId - The rail ID to settle
   * @param untilEpoch - The epoch to settle up to (must be <= current epoch; defaults to current).
   *                     Can be used for partial settlements to a past epoch.
   * @returns Transaction response object
   * @throws Error if untilEpoch is in the future (contract reverts with CannotSettleFutureEpochs)
   */
  async settle(railId: number | bigint, untilEpoch?: number | bigint): Promise<ethers.TransactionResponse> {
    const railIdBigint = typeof railId === 'bigint' ? railId : BigInt(railId)

    const [signerAddress, currentEpoch] = await Promise.all([
      this._signer.getAddress(),
      untilEpoch == null ? getCurrentEpoch(this._provider) : Promise.resolve(null),
    ])

    const untilEpochBigint = untilEpoch == null ? (currentEpoch as bigint) : BigInt(untilEpoch)

    const paymentsContract = this._getPaymentsContract()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {
      value: SETTLEMENT_FEE, // Include the settlement fee (NETWORK_FEE in contract) as msg.value
    }
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const tx = await paymentsContract.settleRail(railIdBigint, untilEpochBigint, txOptions)
      return tx
    } catch (error) {
      throw createError(
        'PaymentsService',
        'settle',
        `Failed to settle rail ${railIdBigint.toString()} up to epoch ${untilEpochBigint.toString()}`,
        error
      )
    }
  }

  /**
   * Get the expected settlement amounts for a rail (read-only simulation)
   * Note: The actual settlement will require a network fee (FIL) to be sent with the transaction
   * @param railId - The rail ID to check
   * @param untilEpoch - The epoch to settle up to (must be <= current epoch; defaults to current).
   *                     Can be used to preview partial settlements to a past epoch.
   * @returns Settlement result with amounts and details
   */
  async getSettlementAmounts(railId: number | bigint, untilEpoch?: number | bigint): Promise<SettlementResult> {
    const railIdBigint = typeof railId === 'bigint' ? railId : BigInt(railId)

    const currentEpoch = untilEpoch == null ? await getCurrentEpoch(this._provider) : null

    const untilEpochBigint = untilEpoch == null ? (currentEpoch as bigint) : BigInt(untilEpoch)

    const paymentsContract = this._getPaymentsContract()

    try {
      // Use staticCall to simulate the transaction and get the return values
      // Include the settlement fee (NETWORK_FEE in contract) in the simulation
      const result = await paymentsContract.settleRail.staticCall(railIdBigint, untilEpochBigint, {
        value: SETTLEMENT_FEE,
      })

      return {
        totalSettledAmount: result[0],
        totalNetPayeeAmount: result[1],
        totalOperatorCommission: result[2],
        finalSettledEpoch: result[3],
        note: result[4],
      }
    } catch (error) {
      throw createError(
        'PaymentsService',
        'getSettlementAmounts',
        `Failed to get settlement amounts for rail ${railIdBigint.toString()} up to epoch ${untilEpochBigint.toString()}`,
        error
      )
    }
  }

  /**
   * Emergency settlement for terminated rails only - bypasses service contract validation
   * This ensures payment even if the validator contract is buggy or unresponsive (pays in full)
   * Can only be called by the client after the max settlement epoch has passed
   * @param railId - The rail ID to settle
   * @returns Transaction response object
   */
  async settleTerminatedRail(railId: number | bigint): Promise<ethers.TransactionResponse> {
    const railIdBigint = typeof railId === 'bigint' ? railId : BigInt(railId)
    const signerAddress = await this._signer.getAddress()
    const paymentsContract = this._getPaymentsContract()

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    try {
      const tx = await paymentsContract.settleTerminatedRailWithoutValidation(railIdBigint, txOptions)
      return tx
    } catch (error) {
      throw createError(
        'PaymentsService',
        'settleTerminatedRail',
        `Failed to settle terminated rail ${railIdBigint.toString()}`,
        error
      )
    }
  }

  /**
   * Get detailed information about a specific rail
   * @param railId - The rail ID to query
   * @returns Rail information including all parameters and current state
   * @throws Error if the rail doesn't exist or is inactive (contract reverts with RailInactiveOrSettled)
   */
  async getRail(railId: number | bigint): Promise<{
    token: string
    from: string
    to: string
    operator: string
    validator: string
    paymentRate: bigint
    lockupPeriod: bigint
    lockupFixed: bigint
    settledUpTo: bigint
    endEpoch: bigint
    commissionRateBps: bigint
    serviceFeeRecipient: string
  }> {
    const railIdBigint = typeof railId === 'bigint' ? railId : BigInt(railId)
    const paymentsContract = this._getPaymentsContract()

    try {
      const rail = await paymentsContract.getRail(railIdBigint)
      return {
        token: rail.token,
        from: rail.from,
        to: rail.to,
        operator: rail.operator,
        validator: rail.validator,
        paymentRate: rail.paymentRate,
        lockupPeriod: rail.lockupPeriod,
        lockupFixed: rail.lockupFixed,
        settledUpTo: rail.settledUpTo,
        endEpoch: rail.endEpoch,
        commissionRateBps: rail.commissionRateBps,
        serviceFeeRecipient: rail.serviceFeeRecipient,
      }
    } catch (error: any) {
      // Contract reverts with RailInactiveOrSettled error if rail doesn't exist
      if (error.message?.includes('RailInactiveOrSettled')) {
        throw createError('PaymentsService', 'getRail', `Rail ${railIdBigint.toString()} does not exist or is inactive`)
      }
      throw createError('PaymentsService', 'getRail', `Failed to get rail ${railIdBigint.toString()}`, error)
    }
  }

  /**
   * Automatically settle a rail, detecting whether it's terminated or active
   * This method checks the rail status and calls the appropriate settlement method:
   * - For terminated rails: calls settleTerminatedRail()
   * - For active rails: calls settle() with optional untilEpoch (requires settlement fee)
   *
   * @param railId - The rail ID to settle
   * @param untilEpoch - The epoch to settle up to (must be <= current epoch for active rails; ignored for terminated rails)
   * @returns Transaction response object
   * @throws Error if rail doesn't exist (contract reverts with RailInactiveOrSettled) or other settlement errors
   *
   * @example
   * ```javascript
   * // Automatically detect and settle appropriately
   * const tx = await synapse.payments.settleAuto(railId)
   * await tx.wait()
   *
   * // For active rails, can specify epoch
   * const tx = await synapse.payments.settleAuto(railId, specificEpoch)
   * ```
   */
  async settleAuto(railId: number | bigint, untilEpoch?: number | bigint): Promise<ethers.TransactionResponse> {
    const railIdBigint = typeof railId === 'bigint' ? railId : BigInt(railId)

    // Get rail information to check if terminated
    const rail = await this.getRail(railIdBigint)

    // Check if rail is terminated (endEpoch > 0 means terminated)
    if (rail.endEpoch > 0n) {
      // Rail is terminated, use settleTerminatedRail
      return await this.settleTerminatedRail(railIdBigint)
    } else {
      // Rail is active, use regular settle (requires settlement fee)
      return await this.settle(railIdBigint, untilEpoch)
    }
  }

  /**
   * Get all rails where the wallet is the payer
   * @param token - The token to filter by (defaults to USDFC)
   * @returns Array of rail information
   */
  async getRailsAsPayer(token: TokenIdentifier = TOKENS.USDFC): Promise<RailInfo[]> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'getRailsAsPayer',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    const signerAddress = await this._signer.getAddress()
    const paymentsContract = this._getPaymentsContract()

    try {
      const rails = await paymentsContract.getRailsForPayerAndToken(signerAddress, this._usdfcAddress)

      return rails.map((rail: any) => ({
        railId: Number(rail.railId),
        isTerminated: rail.isTerminated,
        endEpoch: Number(rail.endEpoch),
      }))
    } catch (error) {
      throw createError('PaymentsService', 'getRailsAsPayer', 'Failed to get rails where wallet is payer', error)
    }
  }

  /**
   * Get all rails where the wallet is the payee
   * @param token - The token to filter by (defaults to USDFC)
   * @returns Array of rail information
   */
  async getRailsAsPayee(token: TokenIdentifier = TOKENS.USDFC): Promise<RailInfo[]> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'getRailsAsPayee',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    const signerAddress = await this._signer.getAddress()
    const paymentsContract = this._getPaymentsContract()

    try {
      const rails = await paymentsContract.getRailsForPayeeAndToken(signerAddress, this._usdfcAddress)

      return rails.map((rail: any) => ({
        railId: Number(rail.railId),
        isTerminated: rail.isTerminated,
        endEpoch: Number(rail.endEpoch),
      }))
    } catch (error) {
      throw createError('PaymentsService', 'getRailsAsPayee', 'Failed to get rails where wallet is payee', error)
    }
  }
}
