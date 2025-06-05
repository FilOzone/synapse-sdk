/**
 * SynapsePayments - Handles all payment-related functionality
 */

import { ethers } from 'ethers'
import type { TokenAmount, TokenIdentifier } from '../types.js'
import { createError, CONTRACT_ADDRESSES, CONTRACT_ABIS, TOKENS } from '../utils/index.js'

export class SynapsePayments {
  private readonly _provider: ethers.Provider
  private readonly _signer: ethers.Signer
  private readonly _network: 'mainnet' | 'calibration'
  private readonly _disableNonceManager: boolean

  // Cached contract instances
  private _usdfcContract: ethers.Contract | null = null
  private _paymentsContract: ethers.Contract | null = null

  // Re-export token constant for convenience
  static readonly USDFC = TOKENS.USDFC

  constructor (
    provider: ethers.Provider,
    signer: ethers.Signer,
    network: 'mainnet' | 'calibration',
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

  async balance (token: TokenIdentifier = SynapsePayments.USDFC): Promise<bigint> {
    // For now, only support USDFC balance
    if (token !== SynapsePayments.USDFC) {
      throw createError(
        'SynapsePayments',
        'payments contract balance check',
        `Token "${token}" is not supported. Currently only USDFC token is supported for payments contract balance queries.`
      )
    }

    const signerAddress = await this._signer.getAddress()

    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const paymentsContract = this._getPaymentsContract()

    let accountInfo: any[]

    try {
      // Get account info from payments contract
      accountInfo = await paymentsContract.accounts(usdfcAddress, signerAddress)
    } catch (contractCallError) {
      throw createError(
        'SynapsePayments',
        'payments contract balance check',
        'Failed to read account information from payments contract. This could indicate the contract is not properly deployed, the ABI is incorrect, or there are network connectivity issues.',
        contractCallError
      )
    }

    // accountInfo returns: (uint256 funds, uint256 lockedFunds, bool frozen)
    const [funds, lockedFunds] = accountInfo

    // Return the available funds (total funds - locked funds) as bigint
    const availableFunds = BigInt(funds) - BigInt(lockedFunds)

    return availableFunds
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
          'SynapsePayments',
          'wallet FIL balance check',
          'Unable to retrieve FIL balance from wallet. This could be due to network connectivity issues, RPC endpoint problems, or wallet connection issues.',
          error
        )
      }
    }

    // Handle ERC20 token balance
    if (token === SynapsePayments.USDFC) {
      try {
        const address = await this._signer.getAddress()
        const usdfcContract = this._getUsdfcContract()
        const balance = await usdfcContract.balanceOf(address)
        return balance
      } catch (error) {
        throw createError(
          'SynapsePayments',
          'wallet USDFC balance check',
          'Unexpected error while checking USDFC token balance in wallet.',
          error
        )
      }
    }

    // For other tokens, could add support later
    throw createError(
      'SynapsePayments',
      'wallet balance check',
      `Token "${token}" is not supported. Currently only USDFC token is supported for balance queries.`
    )
  }

  decimals (token: TokenIdentifier = SynapsePayments.USDFC): number {
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
    if (token !== SynapsePayments.USDFC) {
      throw createError('SynapsePayments', 'allowance', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const signerAddress = await this._signer.getAddress()
    const usdfcContract = this._getUsdfcContract()

    try {
      const currentAllowance = await usdfcContract.allowance(signerAddress, spender)
      return currentAllowance
    } catch (error) {
      throw createError(
        'SynapsePayments',
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
   * @returns Transaction hash
   */
  async approve (token: TokenIdentifier, spender: string, amount: TokenAmount): Promise<string> {
    if (token !== SynapsePayments.USDFC) {
      throw createError('SynapsePayments', 'approve', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const approveAmount = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (approveAmount < 0n) {
      throw createError('SynapsePayments', 'approve', 'Approval amount cannot be negative')
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
      await approveTx.wait()
      return approveTx.hash
    } catch (error) {
      throw createError(
        'SynapsePayments',
        'approve',
        `Failed to approve ${spender} to spend ${approveAmount.toString()} ${token}`,
        error
      )
    }
  }

  /**
   * Approve a service contract to act as an operator for payment rails
   * This allows the service contract to create and manage payment rails on behalf of the client
   * @param service - The service contract address to approve
   * @param rateAllowance - Maximum payment rate per epoch the operator can set
   * @param lockupAllowance - Maximum lockup amount the operator can set
   * @param token - The token to approve for (defaults to USDFC)
   * @returns Transaction hash
   */
  async approveService (
    service: string,
    rateAllowance: TokenAmount,
    lockupAllowance: TokenAmount,
    token: TokenIdentifier = SynapsePayments.USDFC
  ): Promise<string> {
    if (token !== SynapsePayments.USDFC) {
      throw createError('SynapsePayments', 'approveService', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
    }

    const rateAllowanceBigint = typeof rateAllowance === 'bigint' ? rateAllowance : BigInt(rateAllowance)
    const lockupAllowanceBigint = typeof lockupAllowance === 'bigint' ? lockupAllowance : BigInt(lockupAllowance)

    if (rateAllowanceBigint < 0n || lockupAllowanceBigint < 0n) {
      throw createError('SynapsePayments', 'approveService', 'Allowance values cannot be negative')
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
      await approveTx.wait()
      return approveTx.hash
    } catch (error) {
      throw createError(
        'SynapsePayments',
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
   * @returns Transaction hash
   */
  async revokeService (service: string, token: TokenIdentifier = SynapsePayments.USDFC): Promise<string> {
    if (token !== SynapsePayments.USDFC) {
      throw createError('SynapsePayments', 'revokeService', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
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
      await revokeTx.wait()
      return revokeTx.hash
    } catch (error) {
      throw createError(
        'SynapsePayments',
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
  async serviceApproval (service: string, token: TokenIdentifier = SynapsePayments.USDFC): Promise<{
    isApproved: boolean
    rateAllowance: bigint
    rateUsed: bigint
    lockupAllowance: bigint
    lockupUsed: bigint
  }> {
    if (token !== SynapsePayments.USDFC) {
      throw createError('SynapsePayments', 'serviceApproval', `Token "${token}" is not supported. Currently only USDFC token is supported.`)
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
        'SynapsePayments',
        'serviceApproval',
        `Failed to check service approval status for ${service}`,
        error
      )
    }
  }

  async deposit (amount: TokenAmount, token: TokenIdentifier = SynapsePayments.USDFC): Promise<string> {
    // Only support USDFC for now
    if (token !== SynapsePayments.USDFC) {
      throw createError('SynapsePayments', 'deposit', `Unsupported token: ${token}`)
    }

    const depositAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (depositAmountBigint <= 0n) {
      throw createError('SynapsePayments', 'deposit', 'Invalid amount')
    }

    const signerAddress = await this._signer.getAddress()

    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const usdfcContract = this._getUsdfcContract()
    const paymentsContract = this._getPaymentsContract()

    // Check balance
    const usdfcBalance = await usdfcContract.balanceOf(signerAddress)

    if (usdfcBalance < depositAmountBigint) {
      throw createError(
        'SynapsePayments',
        'deposit',
        `Insufficient USDFC: have ${BigInt(
          usdfcBalance
        ).toString()}, need ${depositAmountBigint.toString()}`
      )
    }

    // Check and update allowance if needed
    const paymentsAddress = CONTRACT_ADDRESSES.PAYMENTS[this._network]
    if (paymentsAddress == null) {
      throw createError('SynapsePayments', 'deposit', `Payments contract not deployed on ${this._network}`)
    }

    const currentAllowance = await this.allowance(token, paymentsAddress)

    if (currentAllowance < depositAmountBigint) {
      // Golden path: automatically approve the exact amount needed
      await this.approve(token, paymentsAddress, depositAmountBigint)
    }

    // Check if account is frozen
    const accountInfo = await paymentsContract.accounts(usdfcAddress, signerAddress)
    const [, , frozen] = accountInfo

    if (frozen === true) {
      throw createError('SynapsePayments', 'deposit', 'Account is frozen')
    }

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
    await depositTx.wait()

    return depositTx.hash
  }

  async withdraw (amount: TokenAmount, token: TokenIdentifier = SynapsePayments.USDFC): Promise<string> {
    // Only support USDFC for now
    if (token !== SynapsePayments.USDFC) {
      throw createError('SynapsePayments', 'withdraw', `Unsupported token: ${token}`)
    }

    const withdrawAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)

    if (withdrawAmountBigint <= 0n) {
      throw createError('SynapsePayments', 'withdraw', 'Invalid amount')
    }

    const signerAddress = await this._signer.getAddress()

    const usdfcAddress = CONTRACT_ADDRESSES.USDFC[this._network]
    const paymentsContract = this._getPaymentsContract()

    // Check balance
    const accountInfo = await paymentsContract.accounts(usdfcAddress, signerAddress)

    const [funds, lockedFunds, frozen] = accountInfo
    const availableFunds = BigInt(funds) - BigInt(lockedFunds)

    if (frozen === true) {
      throw createError('SynapsePayments', 'withdraw', 'Account is frozen')
    }

    if (availableFunds < withdrawAmountBigint) {
      throw createError(
        'SynapsePayments',
        'withdraw',
        `Insufficient balance: have ${availableFunds.toString()}, need ${withdrawAmountBigint.toString()}`
      )
    }

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._disableNonceManager) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    const withdrawTx = await paymentsContract.withdraw(usdfcAddress, withdrawAmountBigint, txOptions)
    await withdrawTx.wait()

    return withdrawTx.hash
  }
}
