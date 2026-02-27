import type { Simplify } from 'type-fest'
import type {
  Account,
  Address,
  Chain,
  Client,
  Hash,
  Log,
  SimulateContractErrorType,
  Transport,
  WaitForTransactionReceiptErrorType,
  WriteContractErrorType,
} from 'viem'
import { parseEventLogs, parseSignature } from 'viem'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import * as Abis from '../abis/index.ts'
import { getChain } from '../chains.ts'
import * as erc20 from '../erc20/index.ts'
import { DepositAmountError, InsufficientBalanceError } from '../errors/pay.ts'
import { signErc20Permit } from '../typed-data/sign-erc20-permit.ts'
import type { ActionSyncCallback, ActionSyncOutput } from '../types.ts'
import { TIME_CONSTANTS } from '../utils/constants.ts'

export namespace depositWithPermit {
  export type OptionsType = {
    /** The amount to deposit (in token base units). Must be greater than 0. */
    amount: bigint
    /** The address of the ERC20 token. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The depositor address. If not provided, the client account address will be used. */
    address?: Address
    /** The spender address for the permit. If not provided, the payments contract address will be used. */
    spender?: Address
    /** The permit deadline as a Unix timestamp (seconds). If not provided, defaults to now + 1 hour. */
    deadline?: bigint
  }

  export type ErrorType =
    | erc20.balanceForPermit.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | InsufficientBalanceError
    | DepositAmountError
}

/**
 * Deposit funds into the Filecoin Pay contract using an ERC-2612 permit
 *
 * Signs an EIP-712 permit for the token and calls the `depositWithPermit` contract function
 * to approve and deposit in a single transaction (no prior ERC20 approval needed).
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link depositWithPermit.OptionsType}
 * @returns The transaction hash
 * @throws Errors {@link depositWithPermit.ErrorType}
 *
 * @example
 * ```ts
 * import { depositWithPermit } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http, parseUnits } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const hash = await depositWithPermit(client, {
 *   amount: parseUnits('100', 18),
 * })
 *
 * console.log(hash)
 * ```
 */
export async function depositWithPermit(
  client: Client<Transport, Chain, Account>,
  options: depositWithPermit.OptionsType
): Promise<Hash> {
  const chain = getChain(client.chain.id)
  const token = options.token ?? chain.contracts.usdfc.address
  const address = options.address ?? client.account.address
  const spender = options.spender ?? chain.contracts.filecoinPay.address

  if (options.amount <= 0n) {
    throw new DepositAmountError(options.amount)
  }

  const {
    value: balance,
    name,
    nonce,
    version,
  } = await erc20.balanceForPermit(client, {
    address,
    token,
  })

  if (balance < options.amount) {
    throw new InsufficientBalanceError(balance, options.amount)
  }

  const deadline =
    options.deadline ?? BigInt(Math.floor(Date.now() / 1000)) + BigInt(TIME_CONSTANTS.PERMIT_DEADLINE_DURATION)

  const structuredSignature = parseSignature(
    await signErc20Permit(client, {
      amount: options.amount,
      nonce,
      deadline,
      name,
      version,
      token,
      spender,
    })
  )

  const { request } = await simulateContract(client, {
    account: client.account,
    address: chain.contracts.filecoinPay.address,
    abi: chain.contracts.filecoinPay.abi,
    functionName: 'depositWithPermit',
    args: [
      token,
      address,
      options.amount,
      deadline,
      Number(structuredSignature.v),
      structuredSignature.r,
      structuredSignature.s,
    ],
  })

  return writeContract(client, request)
}

export namespace depositWithPermitSync {
  export type OptionsType = Simplify<depositWithPermit.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractDepositWithPermitEvent>

  export type ErrorType = depositWithPermit.ErrorType | WaitForTransactionReceiptErrorType
}

/**
 * Deposit funds using an ERC-2612 permit and wait for confirmation
 *
 * Signs an EIP-712 permit and deposits, then waits for the transaction to be confirmed.
 * Returns the receipt with the DepositRecorded event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link depositWithPermitSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link depositWithPermitSync.OutputType}
 * @throws Errors {@link depositWithPermitSync.ErrorType}
 *
 * @example
 * ```ts
 * import { depositWithPermitSync } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http, parseUnits } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const { receipt, event } = await depositWithPermitSync(client, {
 *   amount: parseUnits('100', 18),
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Deposited amount:', event.args.amount)
 * ```
 */
export async function depositWithPermitSync(
  client: Client<Transport, Chain, Account>,
  options: depositWithPermitSync.OptionsType
): Promise<depositWithPermitSync.OutputType> {
  const hash = await depositWithPermit(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractDepositWithPermitEvent(receipt.logs)

  return { receipt, event }
}

/**
 * Extracts the DepositRecorded event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The DepositRecorded event
 * @throws Error if the event is not found in the logs
 */
export function extractDepositWithPermitEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.filecoinPay,
    logs,
    eventName: 'DepositRecorded',
    strict: true,
  })
  if (!log) throw new Error('`DepositRecorded` event not found.')
  return log
}
