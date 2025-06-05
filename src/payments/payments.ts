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
      if (paymentsAddress == null) {
        throw new Error(`Payments contract not deployed on ${this._network} network`)
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
    if (token == null || token === 'FIL') {
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
    if (token === 'USDFC' || token === SynapsePayments.USDFC) {
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

  async deposit (amount: TokenAmount, token: TokenIdentifier = SynapsePayments.USDFC): Promise<string> {
    // Only support USDFC for now
    if (token !== 'USDFC' && token !== SynapsePayments.USDFC) {
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
    const currentAllowance = await usdfcContract.allowance(signerAddress, paymentsAddress)

    if (currentAllowance < depositAmountBigint) {
      // Only set explicit nonce if NonceManager is disabled
      const txOptions: any = {}
      if (this._disableNonceManager) {
        const approvalNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
        txOptions.nonce = approvalNonce
      }

      // TODO: Consider refactoring this section out so it can be called separately by the user
      // if they want to control the multi-transaction flow
      const approveTx = await usdfcContract.approve(paymentsAddress, depositAmountBigint, txOptions)
      await approveTx.wait()
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
    if (token !== 'USDFC' && token !== SynapsePayments.USDFC) {
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
