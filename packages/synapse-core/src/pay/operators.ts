import { type Account, type Address, type Chain, type Client, maxUint256, type Transport } from 'viem'
import {
  type ReadContractErrorType,
  readContract,
  type SimulateContractErrorType,
  simulateContract,
  type WriteContractErrorType,
  writeContract,
} from 'viem/actions'
import { getChain } from '../chains.ts'

export type OperatorApprovalsOptions = {
  /**
   * The address of the ERC20 token to query.
   * If not provided, the USDFC token address will be used.
   */
  token?: Address
  /**
   * The address of the account to query.
   */
  address: Address
  /**
   * The address of the operator to query.
   * If not provided, the Warm Storage contract address will be used.
   */
  operator?: Address
}

export type OperatorApprovalsResult = {
  isApproved: boolean
  rateAllowance: bigint
  lockupAllowance: bigint
  rateUsed: bigint
  lockupUsed: bigint
  maxLockupPeriod: bigint
}

/**
 * Get the operator approvals from the payments contract.
 *
 * @param client - The client to use.
 * @param options - The options to use.
 * @returns The operator approvals.
 * @throws - {@link ReadContractErrorType} if the read contract fails.
 */
export async function operatorApprovals(
  client: Client<Transport, Chain>,
  options: OperatorApprovalsOptions
): Promise<OperatorApprovalsResult> {
  const chain = getChain(client.chain.id)
  const token = options.token ?? chain.contracts.usdfc.address
  const operator = options.operator ?? chain.contracts.storage.address

  const operatorApprovals = await readContract(client, {
    address: chain.contracts.payments.address,
    abi: chain.contracts.payments.abi,
    functionName: 'operatorApprovals',
    args: [token, options.address, operator],
  })
  return {
    isApproved: operatorApprovals[0],
    rateAllowance: operatorApprovals[1],
    lockupAllowance: operatorApprovals[2],
    rateUsed: operatorApprovals[3],
    lockupUsed: operatorApprovals[4],
    maxLockupPeriod: operatorApprovals[5],
  }
}

export type SetOperatorApprovalOptions = {
  /**
   * The address of the ERC20 token to query.
   * If not provided, the USDFC token address will be used.
   */
  token?: Address
  /**
   * The address of the operator to query.
   * If not provided, the Warm Storage contract address will be used.
   */
  operator?: Address
  /**
   * Whether to approve the operator.
   */
  approve: boolean
}

/**
 * Set the operator approval for the payments contract.
 *
 * @param client - The client to use.
 * @param options - The options to use.
 * @returns The hash of the approve transaction.
 * @throws - {@link SimulateContractErrorType} if the simulate contract fails.
 * @throws - {@link WriteContractErrorType} if the write contract fails.
 */
export async function setOperatorApproval(
  client: Client<Transport, Chain, Account>,
  options: SetOperatorApprovalOptions
) {
  const chain = getChain(client.chain.id)
  const token = options.token ?? chain.contracts.usdfc.address
  const operator = options.operator ?? chain.contracts.storage.address

  const approvals = await operatorApprovals(client, {
    token,
    address: client.account.address,
    operator,
  })

  const { request } = await simulateContract(client, {
    address: chain.contracts.payments.address,
    abi: chain.contracts.payments.abi,
    functionName: 'setOperatorApproval',
    args: [
      token,
      operator,
      options.approve,
      options.approve ? maxUint256 : 0n,
      options.approve ? maxUint256 : 0n,
      approvals.maxLockupPeriod,
    ],
  })

  const approve = await writeContract(client, request)
  return approve
}
