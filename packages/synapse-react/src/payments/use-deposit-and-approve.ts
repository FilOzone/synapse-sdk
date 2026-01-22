import { getChain } from '@filoz/synapse-core/chains'
import type { DepositAndApproveOptions } from '@filoz/synapse-core/pay'
import * as payments from '@filoz/synapse-core/pay'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TransactionReceipt } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export type UseDepositAndApproveVariables = Pick<DepositAndApproveOptions, 'amount'>
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
  const token = props?.token ?? chain.contracts.usdfc.address
  const from = props?.address ?? account.address

  return useMutation({
    mutationFn: async ({ amount }: UseDepositAndApproveVariables) => {
      const client = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      const hash = await payments.depositAndApprove(client, {
        amount,
      })

      props?.onHash?.(hash)
      const transactionReceipt = await waitForTransactionReceipt(config.getClient(), {
        hash: hash,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-account-info', from, token],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-erc20-balance', from, token],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-operator-approvals', from, token, chain.contracts.storage.address],
      })

      return transactionReceipt
    },
    ...props?.mutation,
  })
}
