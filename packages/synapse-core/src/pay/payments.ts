import { type Account, type Address, type Chain, type Client, maxUint256, parseSignature, type Transport } from 'viem'
import {
  type SimulateContractErrorType,
  simulateContract,
  type WriteContractErrorType,
  writeContract,
} from 'viem/actions'
import { getChain } from '../chains.ts'
import * as erc20 from '../erc20/index.ts'
import { ValidationError } from '../errors/base.ts'
import { DepositAmountError, InsufficientBalanceError } from '../errors/pay.ts'
import { signErc20Permit } from '../typed-data/sign-erc20-permit.ts'
import { LOCKUP_PERIOD } from '../utils/constants.ts'

export type DepositAndApproveOptions = {
  /**
   * The amount to deposit.
   */
  amount: bigint
  /**
   * The address of the operator to approve.
   */
  operator?: Address
  /**
   * The address of the token to deposit. If not provided, the USDFC token address will be used.
   */
  token?: Address
  /**
   * The address of the spender to approve. If not provided, the payments contract address will be used.
   */
  spender?: Address
  /**
   * The address of the account to deposit from. If not provided, the client account address will be used.
   */
  address?: Address
  /**
   * The deadline of the permit. If not provided, the deadline will be set to 1 hour from now.
   */
  deadline?: bigint
  /**
   * The rate allowance to approve. If not provided, the maxUint256 will be used.
   */
  rateAllowance?: bigint
  /**
   * The lockup allowance to approve. If not provided, the maxUint256 will be used.
   */
  lockupAllowance?: bigint
  /**
   * The max lockup period to approve. If not provided, the LOCKUP_PERIOD will be used.
   */
  maxLockupPeriod?: bigint
}

/**
 * Deposit funds to the payments contract and approve an operator.
 *
 * @param client - The client to use.
 * @param options - The options to use.
 * @returns The hash of the deposit transaction.
 * @throws - {@link SimulateContractErrorType} if the simulate contract fails.
 * @throws - {@link WriteContractErrorType} if the write contract fails.
 * @throws - {@link InsufficientBalanceError} if the balance is insufficient.
 */
export async function depositAndApprove(client: Client<Transport, Chain, Account>, options: DepositAndApproveOptions) {
  const chain = getChain(client.chain.id)
  const token = options.token ?? chain.contracts.usdfc.address
  const operator = options.operator ?? chain.contracts.fwss.address
  const address = options.address ?? client.account.address
  const spender = options.spender ?? chain.contracts.filecoinPay.address
  const rateAllowance = options.rateAllowance ?? maxUint256
  const lockupAllowance = options.lockupAllowance ?? maxUint256
  const maxLockupPeriod = options.maxLockupPeriod ?? LOCKUP_PERIOD

  if (rateAllowance < 0n || lockupAllowance < 0n || maxLockupPeriod < 0n) {
    throw new ValidationError('Allowance or lockup period values cannot be negative')
  }

  if (options.amount <= 0n) {
    throw new DepositAmountError(options.amount)
  }

  const {
    value: balance,
    name,
    nonce,
    version,
  } = await erc20.balanceForPermit(client, {
    address: address,
    token: token,
  })

  if (balance < options.amount) {
    throw new InsufficientBalanceError(balance, options.amount)
  }

  const deadline = options.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour

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
    functionName: 'depositWithPermitAndApproveOperator',
    args: [
      token,
      address,
      options.amount,
      deadline,
      Number(structuredSignature.v),
      structuredSignature.r,
      structuredSignature.s,
      operator,
      rateAllowance,
      lockupAllowance,
      maxLockupPeriod,
    ],
  })
  const hash = await writeContract(client, request)

  return hash
}
