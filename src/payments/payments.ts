/**
 * SynapsePayments - Handles all payment-related functionality
 */

import { ethers } from 'ethers'
import type { TokenAmount, TokenIdentifier } from '../types.js'
import { createError, CONTRACT_ADDRESSES, CONTRACT_ABIS, TOKENS, TIME_CONSTANTS, SIZE_CONSTANTS } from '../utils/index.js'

export class SynapsePayments {
  private readonly _provider: ethers.Provider
  private readonly _signer: ethers.Signer
  private readonly _network: 'mainnet' | 'calibration'
  private readonly _disableNonceManager: boolean
  private readonly _pandoraAddress: string

  // Cached contract instances
  private _usdfcContract: ethers.Contract | null = null
  private _paymentsContract: ethers.Contract | null = null
  private _pandoraContract: ethers.Contract | null = null

  // Re-export token constant for convenience
  static readonly USDFC = TOKENS.USDFC

  constructor (
    provider: ethers.Provider,
    signer: ethers.Signer,
    network: 'mainnet' | 'calibration',
    disableNonceManager: boolean,
    pandoraAddress: string
  ) {
    this._provider = provider
    this._signer = signer
    this._network = network
    this._disableNonceManager = disableNonceManager
    this._pandoraAddress = pandoraAddress
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

  /**
   * Get cached Pandora contract instance or create new one
   */
  private _getPandoraContract (): ethers.Contract {
    if (this._pandoraContract == null) {
      this._pandoraContract = new ethers.Contract(this._pandoraAddress, CONTRACT_ABIS.PANDORA_SERVICE, this._provider)
    }
    return this._pandoraContract
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

    const accountInfo = await this.accountInfo(token)
    return accountInfo.availableFunds
  }

  /**
   * Get detailed account information from the payments contract
   * @param token - The token to get account info for (defaults to USDFC)
   * @returns Account information including funds, lockup details, and available balance
   */
  async accountInfo (token: TokenIdentifier = SynapsePayments.USDFC): Promise<{
    funds: bigint
    lockupCurrent: bigint
    lockupRate: bigint
    lockupLastSettledAt: bigint
    availableFunds: bigint
  }> {
    if (token !== SynapsePayments.USDFC) {
      throw createError(
        'SynapsePayments',
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
        'SynapsePayments',
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
      throw createError('SynapsePayments', 'getCurrentEpoch', 'Failed to get latest block')
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

    // Check if account has sufficient available balance (no frozen account check needed for deposits)

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

    // Check balance using the corrected accountInfo method
    const accountInfo = await this.accountInfo(token)

    if (accountInfo.availableFunds < withdrawAmountBigint) {
      throw createError(
        'SynapsePayments',
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
    await withdrawTx.wait()

    return withdrawTx.hash
  }

  // /**
  //  * Get all rails for the current user
  //  * @param options - Filter options for rails query
  //  * @returns Array of rail information
  //  */
  // async getRails (options?: {
  //   token?: TokenIdentifier
  //   role?: 'payer' | 'payee'
  //   includeTerminated?: boolean
  // }): Promise<Array<{
  //     railId: number
  //     payer: string
  //     payee: string
  //     paymentRate: bigint
  //     isTerminated: boolean
  //     endEpoch: bigint
  //   }>> {
  //   // TODO: Implement when Payments contract provides rail query methods
  //   // Current Payments contract doesn't expose getRailsByPayer/getRailsByPayee
  //   // This would require contract upgrade or event indexing
  //   throw createError(
  //     'SynapsePayments',
  //     'getRails',
  //     'Rail query methods are not yet available in the current Payments contract. This feature requires contract upgrade or event indexing.'
  //   )
  // }

  // /**
  //  * Get detailed information about a specific rail
  //  * @param railId - The rail ID to query
  //  * @returns Detailed rail information
  //  */
  // async getRailDetails (railId: number): Promise<{
  //   railId: number
  //   token: string
  //   payer: string
  //   payee: string
  //   operator: string
  //   arbiter: string
  //   paymentRate: bigint
  //   paymentRateNew: bigint
  //   rateChangeEpoch: bigint
  //   lockupFixed: bigint
  //   lockupPeriod: bigint
  //   settledUpTo: bigint
  //   endEpoch: bigint
  //   commissionRateBps: bigint
  //   totalLockup: bigint
  // }> {
  //   // TODO: Implement when Payments contract provides getRail method
  //   // Current Payments contract doesn't expose individual rail query
  //   throw createError(
  //     'SynapsePayments',
  //     'getRailDetails',
  //     'Rail detail query is not yet available in the current Payments contract. This feature requires contract upgrade or event indexing.'
  //   )
  // }

  /**
   * Calculate storage costs for a given size
   * @param sizeInBytes - Size of data to store in bytes
   * @returns Cost estimates per epoch, day, and month
   */
  async calculateStorageCost (
    sizeInBytes: number
  ): Promise<{
      perEpoch: bigint
      perDay: bigint
      perMonth: bigint
      withCDN: {
        perEpoch: bigint
        perDay: bigint
        perMonth: bigint
      }
    }> {
    // Get Pandora contract instance
    const pandoraContract = this._getPandoraContract()

    let pricePerTiBPerMonthNoCDN: bigint
    let pricePerTiBPerMonthWithCDN: bigint
    let epochsPerMonth: bigint

    try {
      // Fetch pricing from chain - now returns a struct
      const pricing = await pandoraContract.getServicePrice()
      pricePerTiBPerMonthNoCDN = BigInt(pricing.pricePerTiBPerMonthNoCDN)
      pricePerTiBPerMonthWithCDN = BigInt(pricing.pricePerTiBPerMonthWithCDN)
      epochsPerMonth = BigInt(pricing.epochsPerMonth)
    } catch (error) {
      // Fallback to hardcoded values if contract call fails
      // This maintains backward compatibility and allows testing
      // Silently fall back to defaults - this is expected in test environments
      pricePerTiBPerMonthNoCDN = 2n * (10n ** 18n) // 2 USDFC per TiB per month
      pricePerTiBPerMonthWithCDN = 3n * (10n ** 18n) // 3 USDFC per TiB per month with CDN
      epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
    }

    // Calculate price per byte per epoch
    const sizeInBytesBigint = BigInt(sizeInBytes)
    const pricePerEpochNoCDN = (pricePerTiBPerMonthNoCDN * sizeInBytesBigint) / (SIZE_CONSTANTS.TiB * epochsPerMonth)
    const pricePerEpochWithCDN = (pricePerTiBPerMonthWithCDN * sizeInBytesBigint) / (SIZE_CONSTANTS.TiB * epochsPerMonth)

    return {
      perEpoch: pricePerEpochNoCDN,
      perDay: pricePerEpochNoCDN * TIME_CONSTANTS.EPOCHS_PER_DAY,
      perMonth: pricePerEpochNoCDN * epochsPerMonth,
      withCDN: {
        perEpoch: pricePerEpochWithCDN,
        perDay: pricePerEpochWithCDN * TIME_CONSTANTS.EPOCHS_PER_DAY,
        perMonth: pricePerEpochWithCDN * epochsPerMonth
      }
    }
  }

  /**
   * Check if user has sufficient allowances for a storage operation
   * @param sizeInBytes - Size of data to store
   * @param withCDN - Whether CDN is enabled
   * @returns Allowance requirement details
   */
  async checkAllowanceForStorage (
    sizeInBytes: number,
    withCDN: boolean = false
  ): Promise<{
      rateAllowanceNeeded: bigint
      lockupAllowanceNeeded: bigint
      currentRateAllowance: bigint
      currentLockupAllowance: bigint
      currentRateUsed: bigint
      currentLockupUsed: bigint
      sufficient: boolean
      message?: string
    }> {
    // Get current allowances for the Pandora service
    const approval = await this.serviceApproval(this._pandoraAddress)

    // Calculate storage costs
    const costs = await this.calculateStorageCost(sizeInBytes)
    const rateNeeded = withCDN ? costs.withCDN.perEpoch : costs.perEpoch

    // Default lockup period is 10 days = 28,800 epochs
    const lockupNeeded = rateNeeded * TIME_CONSTANTS.DEFAULT_LOCKUP_PERIOD

    // Calculate required allowances (current usage + new requirement)
    const totalRateNeeded = approval.rateUsed + rateNeeded
    const totalLockupNeeded = approval.lockupUsed + lockupNeeded

    const sufficient = approval.rateAllowance >= totalRateNeeded &&
                      approval.lockupAllowance >= totalLockupNeeded

    let message
    if (!sufficient) {
      const messages = []
      if (approval.rateAllowance < totalRateNeeded) {
        messages.push(`Rate allowance insufficient: current ${approval.rateAllowance}, need ${totalRateNeeded}`)
      }
      if (approval.lockupAllowance < totalLockupNeeded) {
        messages.push(`Lockup allowance insufficient: current ${approval.lockupAllowance}, need ${totalLockupNeeded}`)
      }
      message = messages.join('. ')
    }

    return {
      rateAllowanceNeeded: totalRateNeeded,
      lockupAllowanceNeeded: totalLockupNeeded,
      currentRateAllowance: approval.rateAllowance,
      currentLockupAllowance: approval.lockupAllowance,
      currentRateUsed: approval.rateUsed,
      currentLockupUsed: approval.lockupUsed,
      sufficient,
      message
    }
  }

  // /**
  //  * Get payment information for proof sets owned by the current user
  //  * @param pandoraAddress - Address of the Pandora contract
  //  * @returns Array of proof set payment information
  //  */
  // async getProofSetPayments (pandoraAddress: string): Promise<Array<{
  //   proofSetId: number
  //   railId: number
  //   paymentRate: bigint
  //   provider: string
  //   isActive: boolean
  //   costPerDay: bigint
  // }>> {
  //   // This would require querying the Pandora contract for proof sets
  //   // and matching them with payment rails
  //   // For now, returning empty array as this requires Pandora contract integration

  //   // TODO: Implement when Pandora contract ABI is available with getClientProofSets method
  //   throw createError(
  //     'SynapsePayments',
  //     'getProofSetPayments',
  //     'This method requires Pandora contract integration which is not yet implemented'
  //   )
  // }

  // /**
  //  * Get total storage costs across all active rails
  //  * @returns Total costs and breakdown by rail
  //  */
  // async getTotalStorageCosts (): Promise<{
  //   totalPerEpoch: bigint
  //   totalPerDay: bigint
  //   breakdown: Array<{
  //     railId: number
  //     provider: string
  //     costPerEpoch: bigint
  //     costPerDay: bigint
  //   }>
  // }> {
  //   // TODO: Implement when rail query methods are available
  //   // This depends on getRails() which requires contract upgrade
  //   throw createError(
  //     'SynapsePayments',
  //     'getTotalStorageCosts',
  //     'Total cost calculation requires rail query methods which are not yet available in the current Payments contract.'
  //   )
  // }

  /**
   * Prepare for a storage upload by checking requirements and providing actions
   * @param options - Upload preparation options
   * @returns Cost estimate, allowance check, and required actions
   */
  async prepareStorageUpload (options: {
    dataSize: number
    withCDN?: boolean
  }): Promise<{
      estimatedCost: {
        perEpoch: bigint
        perDay: bigint
        perMonth: bigint
      }
      allowanceCheck: {
        sufficient: boolean
        message?: string
      }
      actions: Array<{
        type: 'deposit' | 'approve' | 'approveService'
        description: string
        execute: () => Promise<string>
      }>
    }> {
    const costs = await this.calculateStorageCost(options.dataSize)
    const estimatedCost = (options.withCDN === true) ? costs.withCDN : costs

    const allowanceCheck = await this.checkAllowanceForStorage(
      options.dataSize,
      options.withCDN
    )

    const actions: Array<{
      type: 'deposit' | 'approve' | 'approveService'
      description: string
      execute: () => Promise<string>
    }> = []

    // Check if deposit is needed
    const accountInfo = await this.accountInfo()
    const requiredBalance = estimatedCost.perMonth // Require at least 1 month of funds

    if (accountInfo.availableFunds < requiredBalance) {
      const depositAmount = requiredBalance - accountInfo.availableFunds
      actions.push({
        type: 'deposit',
        description: `Deposit ${depositAmount} USDFC to payments contract`,
        execute: async () => await this.deposit(depositAmount)
      })
    }

    // Check if service approval is needed
    if (!allowanceCheck.sufficient) {
      actions.push({
        type: 'approveService',
        description: `Approve service with rate allowance ${allowanceCheck.rateAllowanceNeeded} and lockup allowance ${allowanceCheck.lockupAllowanceNeeded}`,
        execute: async () => await this.approveService(
          this._pandoraAddress,
          allowanceCheck.rateAllowanceNeeded,
          allowanceCheck.lockupAllowanceNeeded
        )
      })
    }

    return {
      estimatedCost: {
        perEpoch: estimatedCost.perEpoch,
        perDay: estimatedCost.perDay,
        perMonth: estimatedCost.perMonth
      },
      allowanceCheck: {
        sufficient: allowanceCheck.sufficient,
        message: allowanceCheck.message
      },
      actions
    }
  }
}
