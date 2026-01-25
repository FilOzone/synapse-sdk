import { asChain } from '@filoz/synapse-core/chains'
import * as ERC20 from '@filoz/synapse-core/erc20'
import * as Pay from '@filoz/synapse-core/pay'
import { signErc20Permit } from '@filoz/synapse-core/typed-data'
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  type Hash,
  parseSignature,
  type TransactionReceipt,
  type Transport,
} from 'viem'
import { getBalance, getBlockNumber, simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import type { RailInfo, SettlementResult, TokenAmount, TokenIdentifier } from '../types.ts'
import { createError, TIMING_CONSTANTS, TOKENS } from '../utils/index.ts'

/**
 * Options for deposit operation
 */
export interface DepositOptions {
  /** Optional recipient address (defaults to signer address if not provided) */
  to?: string
  /** Called when checking current allowance */
  onAllowanceCheck?: (current: bigint, required: bigint) => void
  /** Called when approval transaction is sent */
  onApprovalTransaction?: (tx: Hash) => void
  /** Called when approval is confirmed */
  onApprovalConfirmed?: (receipt: TransactionReceipt) => void
  /** Called before deposit transaction is sent */
  onDepositStarting?: () => void
}

/**
 * PaymentsService - Filecoin Pay client for managing deposits, approvals, and payment rails
 */
export class PaymentsService {
  private readonly _client: Client<Transport, Chain, Account>

  /**
   * @param client - Client instance for balance checks, nonce management, and epoch calculations
   *
   */
  constructor(client: Client<Transport, Chain, Account>) {
    this._client = client
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

    return await Pay.accounts(this._client, {
      owner: this._client.account.address,
    })
  }

  async walletBalance(token?: TokenIdentifier): Promise<bigint> {
    // If no token specified or FIL is requested, return native wallet balance
    if (token == null || token === TOKENS.FIL) {
      try {
        const balance = await getBalance(this._client, {
          address: this._client.account.address,
        })
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
        const balance = await ERC20.balance(this._client, {
          address: this._client.account.address,
        })
        return balance.value
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
  async allowance(spender: Address, token: TokenIdentifier = TOKENS.USDFC): Promise<bigint> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'allowance',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    try {
      const balance = await ERC20.balance(this._client, {
        address: spender,
      })
      return balance.allowance
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
  async approve(spender: Address, amount: TokenAmount, token: TokenIdentifier = TOKENS.USDFC): Promise<Hash> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'approve',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    try {
      const approveTx = await ERC20.approveAllowance(this._client, {
        spender: spender,
        amount,
      })
      return approveTx
    } catch (error) {
      throw createError(
        'PaymentsService',
        'approve',
        `Failed to approve ${spender} to spend ${amount.toString()} ${token}`,
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
    service: Address,
    rateAllowance: TokenAmount,
    lockupAllowance: TokenAmount,
    maxLockupPeriod: TokenAmount,
    token: TokenIdentifier = TOKENS.USDFC
  ): Promise<Hash> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'approveService',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    try {
      const approveTx = await Pay.setOperatorApproval(this._client, {
        operator: service,
        approve: true,
        rateAllowance: rateAllowance,
        lockupAllowance: lockupAllowance,
        maxLockupPeriod: maxLockupPeriod,
      })
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
  async revokeService(service: Address, token: TokenIdentifier = TOKENS.USDFC): Promise<Hash> {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'revokeService',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    try {
      const revokeTx = await Pay.setOperatorApproval(this._client, {
        operator: service,
        approve: false,
      })
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
  async serviceApproval(service: Address, token: TokenIdentifier = TOKENS.USDFC) {
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'serviceApproval',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    try {
      const approval = await Pay.operatorApprovals(this._client, {
        client: this._client.account.address,
        operator: service,
      })
      return approval
    } catch (error) {
      throw createError(
        'PaymentsService',
        'serviceApproval',
        `Failed to check service approval status for ${service}`,
        error
      )
    }
  }

  async deposit(amount: TokenAmount, token: TokenIdentifier = TOKENS.USDFC, options?: DepositOptions): Promise<Hash> {
    const chain = asChain(this._client.chain)
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'deposit', `Unsupported token: ${token}`)
    }

    if (amount <= 0n) {
      throw createError('PaymentsService', 'deposit', 'Invalid amount')
    }

    // Check balance
    const erc20Balance = await ERC20.balance(this._client, {
      address: this._client.account.address,
    })

    if (erc20Balance.value < amount) {
      throw createError(
        'PaymentsService',
        'deposit',
        `Insufficient USDFC: have ${erc20Balance.value.toString()}, need ${amount.toString()}`
      )
    }

    // Check and update allowance if needed
    const currentAllowance = erc20Balance.allowance

    options?.onAllowanceCheck?.(currentAllowance, amount)

    if (currentAllowance < amount) {
      // Golden path: automatically approve the exact amount needed
      const approveTx = await this.approve(chain.contracts.payments.address, amount, token)

      options?.onApprovalTransaction?.(approveTx)

      // Wait for approval to be mined before proceeding
      const approvalReceipt = await waitForTransactionReceipt(this._client, {
        hash: approveTx,
      })
      if (approvalReceipt != null) {
        options?.onApprovalConfirmed?.(approvalReceipt)
      }
    }

    // Check if account has sufficient available balance (no frozen account check needed for deposits)

    // Notify that deposit is starting
    options?.onDepositStarting?.()

    const depositTx = await Pay.deposit(this._client, {
      amount,
    })

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
    deadline?: bigint
  ): Promise<Hash> {
    const chain = asChain(this._client.chain)
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'depositWithPermit', `Unsupported token: ${token}`)
    }

    if (amount <= 0n) {
      throw createError('PaymentsService', 'depositWithPermit', 'Invalid amount')
    }

    // Calculate deadline
    const permitDeadline: bigint =
      deadline == null ? BigInt(Math.floor(Date.now() / 1000) + TIMING_CONSTANTS.PERMIT_DEADLINE_DURATION) : deadline

    const balance = await ERC20.balanceForPermit(this._client, {
      address: this._client.account.address,
    })
    if (balance.value < amount) {
      throw createError('PaymentsService', 'depositWithPermit', 'Insufficient balance')
    }
    const signature = parseSignature(
      await signErc20Permit(this._client, {
        amount,
        nonce: balance.nonce,
        deadline: permitDeadline,
        name: balance.name,
        version: balance.version,
        token: chain.contracts.usdfc.address,
        spender: chain.contracts.payments.address,
      })
    )

    try {
      const { request } = await simulateContract(this._client, {
        account: this._client.account,
        address: chain.contracts.payments.address,
        abi: chain.contracts.payments.abi,
        functionName: 'depositWithPermit',
        args: [
          chain.contracts.usdfc.address,
          this._client.account.address,
          amount,
          permitDeadline,
          Number(signature.v),
          signature.r,
          signature.s,
        ],
      })
      const hash = await writeContract(this._client, request)
      return hash
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
    operator?: Address,
    rateAllowance?: TokenAmount,
    lockupAllowance?: TokenAmount,
    maxLockupPeriod?: bigint,
    deadline?: bigint,
    token: TokenIdentifier = TOKENS.USDFC
  ): Promise<Hash> {
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'depositWithPermitAndApproveOperator', `Unsupported token: ${token}`)
    }

    try {
      const hash = await Pay.depositAndApprove(this._client, {
        amount,
        operator,
        rateAllowance,
        lockupAllowance,
        maxLockupPeriod,
        deadline,
      })
      return hash
    } catch (error) {
      throw createError(
        'PaymentsService',
        'depositWithPermitAndApproveOperator',
        'Failed to execute depositWithPermitAndApproveOperator on Payments contract.',
        error
      )
    }
  }

  async withdraw(amount: TokenAmount, token: TokenIdentifier = TOKENS.USDFC): Promise<Hash> {
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'withdraw', `Unsupported token: ${token}`)
    }

    if (amount <= 0n) {
      throw createError('PaymentsService', 'withdraw', 'Invalid amount')
    }

    // Check balance using the corrected accountInfo method
    const accountInfo = await this.accountInfo(token)

    if (accountInfo.availableFunds < amount) {
      throw createError(
        'PaymentsService',
        'withdraw',
        `Insufficient available balance: have ${accountInfo.availableFunds.toString()}, need ${amount.toString()}`
      )
    }

    const hash = await Pay.withdraw(this._client, {
      amount,
    })

    return hash
  }

  /**
   * Settle a payment rail up to a specific epoch (sends a transaction)
   *
   * @param railId - The rail ID to settle
   * @param untilEpoch - The epoch to settle up to (must be <= current epoch; defaults to current).
   *                     Can be used for partial settlements to a past epoch.
   * @returns Transaction response object
   * @throws Error if untilEpoch is in the future (contract reverts with CannotSettleFutureEpochs)
   */
  async settle(railId: bigint, untilEpoch?: bigint): Promise<Hash> {
    try {
      const hash = await Pay.settleRail(this._client, {
        railId,
        untilEpoch,
      })
      return hash
    } catch (error) {
      throw createError(
        'PaymentsService',
        'settle',
        `Failed to settle rail ${railId.toString()} up to epoch ${untilEpoch?.toString()}`,
        error
      )
    }
  }

  /**
   * Get the expected settlement amounts for a rail (read-only simulation)
   *
   * @param railId - The rail ID to check
   * @param untilEpoch - The epoch to settle up to (must be <= current epoch; defaults to current).
   *                     Can be used to preview partial settlements to a past epoch.
   * @returns Settlement result with amounts and details
   */
  async getSettlementAmounts(railId: bigint, untilEpoch?: bigint): Promise<SettlementResult> {
    const currentEpoch = await getBlockNumber(this._client, {
      cacheTime: 0,
    })
    try {
      // Use staticCall to simulate the transaction and get the return values
      const { result } = await simulateContract(
        this._client,
        Pay.settleRailCall({
          railId,
          untilEpoch: untilEpoch ?? currentEpoch,
          chain: this._client.chain,
        })
      )

      return {
        totalSettledAmount: result[0],
        totalNetPayeeAmount: result[1],
        totalOperatorCommission: result[2],
        totalNetworkFee: result[3],
        finalSettledEpoch: result[4],
        note: result[5],
      }
    } catch (error) {
      throw createError(
        'PaymentsService',
        'getSettlementAmounts',
        `Failed to get settlement amounts for rail ${railId.toString()} up to epoch ${untilEpoch?.toString()}`,
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
  async settleTerminatedRail(railId: bigint): Promise<Hash> {
    try {
      const hash = await Pay.settleTerminatedRailWithoutValidation(this._client, {
        railId,
      })
      return hash
    } catch (error) {
      throw createError(
        'PaymentsService',
        'settleTerminatedRail',
        `Failed to settle terminated rail ${railId.toString()}`,
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
  async getRail(railId: bigint): Promise<{
    token: Address
    from: Address
    to: Address
    operator: Address
    validator: Address
    paymentRate: bigint
    lockupPeriod: bigint
    lockupFixed: bigint
    settledUpTo: bigint
    endEpoch: bigint
    commissionRateBps: bigint
    serviceFeeRecipient: Address
  }> {
    try {
      const rail = await Pay.getRail(this._client, {
        railId,
      })

      return rail
    } catch (error: any) {
      // Contract reverts with RailInactiveOrSettled error if rail doesn't exist
      if (error.message?.includes('RailInactiveOrSettled')) {
        throw createError('PaymentsService', 'getRail', `Rail ${railId.toString()} does not exist or is inactive`)
      }
      throw createError('PaymentsService', 'getRail', `Failed to get rail ${railId.toString()}`, error)
    }
  }

  /**
   * Automatically settle a rail, detecting whether it's terminated or active
   * This method checks the rail status and calls the appropriate settlement method:
   * - For terminated rails: calls settleTerminatedRail()
   * - For active rails: calls settle() with optional untilEpoch
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
  async settleAuto(railId: bigint, untilEpoch?: bigint): Promise<Hash> {
    // Get rail information to check if terminated
    const rail = await this.getRail(railId)

    // Check if rail is terminated (endEpoch > 0 means terminated)
    if (rail.endEpoch > 0n) {
      // Rail is terminated, use settleTerminatedRail
      return await this.settleTerminatedRail(railId)
    } else {
      // Rail is active, use regular settle (requires settlement fee)
      return await this.settle(railId, untilEpoch)
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

    try {
      const { results } = await Pay.getRailsForPayerAndToken(this._client, {
        payer: this._client.account.address,
      })

      return results
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

    try {
      const { results } = await Pay.getRailsForPayeeAndToken(this._client, {
        payee: this._client.account.address,
      })

      return results
    } catch (error) {
      throw createError('PaymentsService', 'getRailsAsPayee', 'Failed to get rails where wallet is payee', error)
    }
  }
}
