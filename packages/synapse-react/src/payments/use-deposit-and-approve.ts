import { getChain } from '@filoz/synapse-core/chains'
import type { DepositAndApproveOptions } from '@filoz/synapse-core/pay'
import * as payments from '@filoz/synapse-core/pay'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TransactionReceipt } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

/**
 * The variables for the deposit and approve mutation.
 *
 * `rateAllowance`, `lockupAllowance`, `maxLockupPeriod` and `deadline` override the values passed as props.
 */
export type UseDepositAndApproveVariables = Pick<DepositAndApproveOptions, 'amount'> &
  Partial<Pick<DepositAndApproveOptions, 'rateAllowance' | 'lockupAllowance' | 'maxLockupPeriod' | 'deadline'>>

export interface UseDepositAndApproveProps extends Omit<DepositAndApproveOptions, 'amount'> {
  /**
   * The mutation options.
   */
  mutation?: Omit<MutateOptions<TransactionReceipt, Error, UseDepositAndApproveVariables>, 'mutationFn'>
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
}

/**
 * Deposit and approve ERC20 tokens into the payments contract.
 *
 * @param props - The props for the deposit. {@link UseDepositAndApproveProps}
 * @returns The deposit and approve mutation.
 */
export function useDepositAndApprove(props?: UseDepositAndApproveProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  const { mutation, onHash, ...options } = props ?? {}
  const token = options.token ?? chain.contracts.usdfc.address
  const operator = options.operator ?? chain.contracts.fwss.address
  const from = options.address ?? account.address

  return useMutation({
    ...mutation,
    mutationFn: async (variables: UseDepositAndApproveVariables) => {
      const client = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      const hash = await payments.depositAndApprove(client, {
        ...options,
        amount: variables.amount,
        rateAllowance: variables.rateAllowance ?? options.rateAllowance,
        lockupAllowance: variables.lockupAllowance ?? options.lockupAllowance,
        maxLockupPeriod: variables.maxLockupPeriod ?? options.maxLockupPeriod,
        deadline: variables.deadline ?? options.deadline,
      })

      onHash?.(hash)
      const transactionReceipt = await waitForTransactionReceipt(client, {
        hash: hash,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-account-info', from, token, chainId],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-erc20-balance', from, token, chainId],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-operator-approvals', from, token, operator, chainId],
      })

      return transactionReceipt
    },
  })
}
