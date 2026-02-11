import { asChain } from '@filoz/synapse-core/chains'
import * as ERC20 from '@filoz/synapse-core/erc20'
import * as Pay from '@filoz/synapse-core/pay'
import { signErc20Permit } from '@filoz/synapse-core/typed-data'
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  createClient,
  type Hash,
  http,
  parseSignature,
  type TransactionReceipt,
  type Transport,
} from 'viem'
import { getBalance, getBlockNumber, simulateContract, writeContract } from 'viem/actions'
import type { RailInfo, SettlementResult, TokenAmount, TokenIdentifier } from '../types.ts'
import { createError, DEFAULT_CHAIN, TIME_CONSTANTS, TOKENS } from '../utils/index.ts'

/**
 * Options for deposit operation
 */
export interface DepositOptions {
  /** Optional recipient address (defaults to wallet address if not provided) */
  to?: Address
  /** The amount to deposit */
  amount: TokenAmount
  /** The token to deposit (defaults to USDFC) */
  token?: TokenIdentifier
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
   * Create a new PaymentsService instance
   *
   * @param options - Options for the PaymentsService
   * @param options.client - Viem wallet client
   * @returns A new PaymentsService instance
   */
  constructor(options: { client: Client<Transport, Chain, Account> }) {
    this._client = options.client
  }

  /**
   * Create a new PaymentsService with pre-configured client
   *
   * @param options - Options for the PaymentsService
   * @param options.transport - Viem transport (optional, defaults to http())
   * @param options.chain - Filecoin chain (optional, defaults to {@link DEFAULT_CHAIN})
   * @param options.account - Viem account (required)
   * @returns A new {@link PaymentsService} instance
   */
  static create(options: { transport?: Transport; chain?: Chain; account: Account }): PaymentsService {
    const client = createClient({
      chain: options.chain ?? DEFAULT_CHAIN,
      transport: options.transport ?? http(),
      account: options.account,
      name: 'PaymentsService',
      key: 'payments-service',
    })

    if (client.account.type === 'json-rpc' && client.transport.type !== 'custom') {
      throw new Error('Transport must be a custom transport. See https://viem.sh/docs/clients/transports/custom.')
    }
    return new PaymentsService({ client })
  }

  /**
   * Get the balance of the payments contract
   * @param options - Options for the balance
   * @param options.token - The token to get balance for (defaults to USDFC)
   * @returns The balance of the payments contract
   * @throws Errors {@link Pay.accounts.ErrorType}
   */
  async balance(options: { token?: TokenIdentifier } = { token: TOKENS.USDFC }): Promise<bigint> {
    // For now, only support USDFC balance
    if (options.token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'payments contract balance check',
        `Token "${options.token}" is not supported. Currently only USDFC token is supported for payments contract balance queries.`
      )
    }

    const accountInfo = await this.accountInfo({ token: options.token })
    return accountInfo.availableFunds
  }

  /**
   * Get detailed account information from the payments contract
   * @param options - Options for the account info
   * @param options.token - The token to get account info for (defaults to USDFC)
   * @returns Account information {@link Pay.accounts.OutputType}
   * @throws Errors {@link Pay.accounts.ErrorType}
   */
  async accountInfo(options: { token?: TokenIdentifier } = { token: TOKENS.USDFC }): Promise<Pay.accounts.OutputType> {
    if (options.token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'account info',
        `Token "${options.token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    return await Pay.accounts(this._client, {
      address: this._client.account.address,
    })
  }

  /**
   * Get the balance of the wallet
   *
   * @param options - Options for the wallet balance
   * @param options.token - The token to get wallet balance for (defaults to FIL)
   * @returns The balance of the wallet
   * @throws Errors {@link getBalance.ErrorType}
   */
  async walletBalance(options: { token?: TokenIdentifier } = {}): Promise<bigint> {
    const { token = TOKENS.FIL } = options
    // If no token specified or FIL is requested, return native wallet balance
    if (token === TOKENS.FIL) {
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

  decimals(): number {
    // Both FIL and USDFC use 18 decimals
    return 18
  }

  /**
   * Check the current ERC20 token allowance for a spender
   *
   * @param options - Options for the allowance check
   * @param options.spender - The address to check allowance for
   * @param options.token - The token to check allowance for (defaults to USDFC)
   * @returns The current allowance amount as bigint
   * @throws Errors {@link ERC20.balance.ErrorType}
   */
  async allowance(options: { spender: Address; token?: TokenIdentifier }): Promise<bigint> {
    const { spender, token = TOKENS.USDFC } = options
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'allowance',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    try {
      const balance = await ERC20.balance(this._client, {
        address: this._client.account.address,
        spender,
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
   *
   * @param options - Options for the approve
   * @param options.spender - The address to approve as spender
   * @param options.amount - The amount to approve
   * @param options.token - The token to approve spending for (defaults to USDFC)
   * @returns Transaction response object
   */
  async approve(options: { spender: Address; amount: TokenAmount; token?: TokenIdentifier }): Promise<Hash> {
    const { spender, amount, token = TOKENS.USDFC } = options
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'approve',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    try {
      const approveTx = await ERC20.approve(this._client, {
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
   * @param options - Options for the approve service
   * @param options.service - The service contract address to approve (defaults to Warm Storage contract address)
   * @param options.rateAllowance - Maximum payment rate per epoch the operator can set (defaults to maxUint256)
   * @param options.lockupAllowance - Maximum lockup amount the operator can set (defaults to maxUint256)
   * @param options.maxLockupPeriod - Maximum lockup period in epochs the operator can set (defaults to 30 days in epochs)
   * @param options.token - The token to approve for (defaults to USDFC)
   * @returns Transaction hash {@link Hash}
   * @throws Errors {@link Pay.setOperatorApproval.ErrorType}
   */
  async approveService(
    options: {
      service?: Address
      rateAllowance?: TokenAmount
      lockupAllowance?: TokenAmount
      maxLockupPeriod?: TokenAmount
      token?: TokenIdentifier
    } = {}
  ): Promise<Hash> {
    const { service, rateAllowance, lockupAllowance, maxLockupPeriod, token = TOKENS.USDFC } = options
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
   *
   * @param options - Options for the revoke service
   * @param options.service - The service contract address to revoke (defaults to Warm Storage contract address)
   * @param options.token - The token to revoke approval for (defaults to USDFC)
   * @returns Transaction hash {@link Hash}
   * @throws Errors {@link Pay.setOperatorApproval.ErrorType}
   */
  async revokeService(options: { service?: Address; token?: TokenIdentifier } = {}): Promise<Hash> {
    const { service, token = TOKENS.USDFC } = options
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
   *
   * @param options - Options for the service approval
   * @param options.service - The service contract address to check (defaults to Warm Storage contract address)
   * @param options.token - The token to check approval for (defaults to USDFC)
   * @returns Approval status and allowances {@link Pay.operatorApprovals.OutputType}
   * @throws Errors {@link Pay.operatorApprovals.ErrorType}
   */
  async serviceApproval(
    options: { service?: Address; token?: TokenIdentifier } = {}
  ): Promise<Pay.operatorApprovals.OutputType> {
    const { service, token = TOKENS.USDFC } = options
    if (token !== TOKENS.USDFC) {
      throw createError(
        'PaymentsService',
        'serviceApproval',
        `Token "${token}" is not supported. Currently only USDFC token is supported.`
      )
    }

    try {
      const approval = await Pay.operatorApprovals(this._client, {
        address: this._client.account.address,
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

  /**
   * Deposit funds into the payments contract
   *
   * @param options - Options for the deposit {@link DepositOptions}
   * @returns Transaction hash {@link Hash}
   * @throws Errors {@link ERC20.balance.ErrorType} | {@link ERC20.approve.ErrorType} | {@link Pay.deposit.ErrorType}
   */
  async deposit(options: DepositOptions): Promise<Hash> {
    const { amount, token = TOKENS.USDFC } = options
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
      const { receipt } = await ERC20.approveSync(this._client, {
        spender: chain.contracts.filecoinPay.address,
        amount,
        onHash: options?.onApprovalTransaction,
      })

      options?.onApprovalConfirmed?.(receipt)
    }

    // Notify that deposit is starting
    options?.onDepositStarting?.()

    const depositTx = await Pay.deposit(this._client, {
      amount,
      to: options?.to,
    })

    return depositTx
  }

  /**
   * Deposit funds using ERC-2612 permit to approve and deposit in a single transaction
   * This method creates an EIP-712 typed-data signature for the USDFC token's permit,
   * then calls the Payments contract `depositWithPermit` to pull funds and credit the account.
   *
   * @param options - Options for the deposit with permit {@link DepositWithPermitOptions}
   * @param options.amount - Amount of USDFC to deposit (in base units)
   * @param options.token - Token identifier (currently only USDFC is supported)
   * @param options.deadline - Unix timestamp (seconds) when the permit expires. Defaults to now + 1 hour.
   * @returns Transaction response object {@link Hash}
   * @throws Errors {@link ERC20.balanceForPermit.ErrorType} | {@link ERC20.permit.ErrorType} | {@link Pay.depositWithPermit.ErrorType}
   */
  async depositWithPermit(options: { amount: TokenAmount; token?: TokenIdentifier; deadline?: bigint }): Promise<Hash> {
    const { amount, token = TOKENS.USDFC, deadline } = options
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
      deadline == null ? BigInt(Math.floor(Date.now() / 1000) + TIME_CONSTANTS.PERMIT_DEADLINE_DURATION) : deadline

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
        spender: chain.contracts.filecoinPay.address,
      })
    )

    try {
      const { request } = await simulateContract(this._client, {
        account: this._client.account,
        address: chain.contracts.filecoinPay.address,
        abi: chain.contracts.filecoinPay.abi,
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
   * @param options - Options for the deposit with permit and approve operator
   * @param options.amount - Amount of USDFC to deposit (in base units)
   * @param options.operator - Service/operator address to approve
   * @param options.rateAllowance - Max payment rate per epoch operator can set
   * @param options.lockupAllowance - Max lockup amount operator can set
   * @param options.maxLockupPeriod - Max lockup period in epochs operator can set
   * @param options.token - Token identifier (currently only USDFC supported)
   * @param options.deadline - Unix timestamp (seconds) when the permit expires. Defaults to now + 1 hour.
   * @returns Transaction hash {@link Hash}
   * @throws Errors {@link ERC20.balanceForPermit.ErrorType} | {@link ERC20.permit.ErrorType} | {@link Pay.depositWithPermitAndApproveOperator.ErrorType}
   */
  async depositWithPermitAndApproveOperator(options: {
    amount: TokenAmount
    operator?: Address
    rateAllowance?: TokenAmount
    lockupAllowance?: TokenAmount
    maxLockupPeriod?: bigint
    deadline?: bigint
    token?: TokenIdentifier
  }): Promise<Hash> {
    const {
      amount,
      operator,
      rateAllowance,
      lockupAllowance,
      maxLockupPeriod,
      deadline,
      token = TOKENS.USDFC,
    } = options
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

  /**
   * Withdraw funds from the payments contract
   *
   * @param options - Options for the withdraw
   * @param options.amount - The amount to withdraw
   * @param options.token - The token to withdraw (defaults to USDFC)
   * @returns Transaction hash {@link Hash}
   * @throws Errors {@link Pay.withdraw.ErrorType}
   */
  async withdraw(options: { amount: TokenAmount; token?: TokenIdentifier }): Promise<Hash> {
    const { amount, token = TOKENS.USDFC } = options
    // Only support USDFC for now
    if (token !== TOKENS.USDFC) {
      throw createError('PaymentsService', 'withdraw', `Unsupported token: ${token}`)
    }

    return Pay.withdraw(this._client, {
      amount,
    })
  }

  /**
   * Settle a payment rail up to a specific epoch (sends a transaction)
   *
   * @param options - Options for the settle
   * @param options.railId - The rail ID to settle
   * @param options.untilEpoch - The epoch to settle up to (must be <= current epoch; defaults to current). Can be used for partial settlements to a past epoch.
   * @returns Transaction hash {@link Hash}
   * @throws Errors {@link Pay.settleRail.ErrorType}
   */
  async settle(options: { railId: bigint; untilEpoch?: bigint }): Promise<Hash> {
    return Pay.settleRail(this._client, options)
  }

  /**
   * Get the expected settlement amounts for a rail (read-only simulation)
   *
   * @param options - Options for the get settlement amounts
   * @param options.railId - The rail ID to check
   * @param options.untilEpoch - The epoch to settle up to (must be <= current epoch; defaults to current). Can be used to preview partial settlements to a past epoch.
   * @returns Settlement result with amounts and details {@link SettlementResult}
   */
  async getSettlementAmounts(options: { railId: bigint; untilEpoch?: bigint }): Promise<SettlementResult> {
    const { railId, untilEpoch } = options
    const _untilEpoch =
      untilEpoch ??
      (await getBlockNumber(this._client, {
        cacheTime: 0,
      }))

    try {
      // Use staticCall to simulate the transaction and get the return values
      const { result } = await simulateContract(
        this._client,
        Pay.settleRailCall({
          railId,
          untilEpoch: _untilEpoch,
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
        `Failed to get settlement amounts for rail ${railId.toString()} up to epoch ${_untilEpoch.toString()}`,
        error
      )
    }
  }

  /**
   * Emergency settlement for terminated rails only - bypasses service contract validation
   * This ensures payment even if the validator contract is buggy or unresponsive (pays in full)
   * Can only be called by the client after the max settlement epoch has passed
   * @param options - Options for the settle terminated rail
   * @param options.railId - The rail ID to settle
   * @returns Transaction hash {@link Hash}
   * @throws Errors {@link Pay.settleTerminatedRailWithoutValidation.ErrorType}
   */
  async settleTerminatedRail(options: { railId: bigint }): Promise<Hash> {
    return Pay.settleTerminatedRailWithoutValidation(this._client, options)
  }

  /**
   * Get detailed information about a specific rail
   * @param options - Options for the get rail
   * @param options.railId - The rail ID to query
   * @returns Rail information including all parameters and current state {@link Pay.getRail.OutputType}
   * @throws When the rail does not exist or is inactive
   */
  async getRail(options: { railId: bigint }): Promise<Pay.getRail.OutputType> {
    try {
      const rail = await Pay.getRail(this._client, options)

      return rail
    } catch (error: any) {
      // Contract reverts with RailInactiveOrSettled error if rail doesn't exist
      if (error.message?.includes('RailInactiveOrSettled')) {
        throw createError(
          'PaymentsService',
          'getRail',
          `Rail ${options.railId.toString()} does not exist or is inactive`
        )
      }
      throw createError('PaymentsService', 'getRail', `Failed to get rail ${options.railId.toString()}`, error)
    }
  }

  /**
   * Automatically settle a rail, detecting whether it's terminated or active
   * This method checks the rail status and calls the appropriate settlement method:
   * - For terminated rails: calls settleTerminatedRail()
   * - For active rails: calls settle() with optional untilEpoch
   *
   * @param options - Options for the settle auto
   * @param options.railId - The rail ID to settle
   * @param options.untilEpoch - The epoch to settle up to (must be <= current epoch for active rails; ignored for terminated rails)
   * @returns Transaction response object {@link Hash}
   * @throws Error if rail doesn't exist (contract reverts with RailInactiveOrSettled) or other settlement errors
   *
   * @example
   * ```ts
   * // Automatically detect and settle appropriately
   * const hash = await synapse.payments.settleAuto({ railId })
   *
   * // For active rails, can specify epoch
   * const hash = await synapse.payments.settleAuto({ railId, untilEpoch: specificEpoch })
   * ```
   */
  async settleAuto(options: { railId: bigint; untilEpoch?: bigint }): Promise<Hash> {
    // Get rail information to check if terminated
    const rail = await this.getRail(options)

    // Check if rail is terminated (endEpoch > 0 means terminated)
    if (rail.endEpoch > 0n) {
      // Rail is terminated, use settleTerminatedRail
      return await this.settleTerminatedRail(options)
    } else {
      // Rail is active, use regular settle (requires settlement fee)
      return await this.settle(options)
    }
  }

  /**
   * Get all rails where the wallet is the payer
   * @param options - Options for the get rails as payer
   * @param options.token - The token to filter by (defaults to USDFC)
   * @returns Array of rail information {@link RailInfo[]}
   */
  async getRailsAsPayer(options: { token?: TokenIdentifier } = {}): Promise<RailInfo[]> {
    const { token = TOKENS.USDFC } = options
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
   * @param options - Options for the get rails as payee
   * @param options.token - The token to filter by (defaults to USDFC)
   * @returns Array of rail information {@link RailInfo[]}
   */
  async getRailsAsPayee(options: { token?: TokenIdentifier } = {}): Promise<RailInfo[]> {
    const { token = TOKENS.USDFC } = options
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
