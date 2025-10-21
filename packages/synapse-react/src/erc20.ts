import { getChain } from '@filoz/synapse-core/chains'
import type { ERC20BalanceOptions, ERC20BalanceResult } from '@filoz/synapse-core/erc20'
import * as erc20 from '@filoz/synapse-core/erc20'
import {
  type MutateOptions,
  skipToken,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { SetOptional } from 'type-fest'
import type { TransactionReceipt } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { useAccount, useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

interface UseERC20BalanceProps extends SetOptional<ERC20BalanceOptions, 'address'> {
  query?: Omit<UseQueryOptions<ERC20BalanceResult>, 'queryKey' | 'queryFn'>
}

/**
 * Get the balance and allowance of the ERC20 token.
 *
 * @param props - The props to use.
 * @returns The balance and allowance of the ERC20 token.
 */
export function useERC20Balance(props: UseERC20BalanceProps) {
  const config = useConfig()
  const chain = getChain(config.state.chainId)
  const token = props.token ?? chain.contracts.usdfc.address
  const address = props.address

  const result = useQuery({
    ...props.query,
    queryKey: ['synapse-erc20-balance', address, token],
    queryFn: address
      ? async () => {
          const result = await erc20.balance(config.getClient(), {
            address,
            token,
          })

          return result
        }
      : skipToken,
  })
  return result
}

type UseApproveAllowanceVariables = Pick<erc20.ERC20ApproveAllowanceOptions, 'amount'>

interface UseApproveAllowanceProps extends Omit<erc20.ERC20ApproveAllowanceOptions, 'amount'> {
  /**
   * The mutation options.
   */
  mutation?: Omit<MutateOptions<TransactionReceipt, Error, UseApproveAllowanceVariables>, 'mutationFn'>
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
}

/**
 * Approve the allowance of the ERC20 token to the payments contract.
 *
 * @param props - The props to use.
 * @returns The mutation to approve the allowance of the ERC20 token to the payments contract.
 */
export function useApproveAllowance(props?: UseApproveAllowanceProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  const chain = getChain(config.state.chainId)
  const token = props?.token ?? chain.contracts.usdfc.address

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ amount }: UseApproveAllowanceVariables) => {
      const client = await getConnectorClient(config, {
        account: account.address,
        chainId,
        connector: account.connector,
      })

      const approve = await erc20.approveAllowance(client, {
        token: props?.token,
        amount,
      })

      props?.onHash?.(approve)
      const transactionReceipt = await waitForTransactionReceipt(config.getClient(), {
        hash: approve,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-erc20-balance', account.address, token],
      })
      return transactionReceipt
    },
  })
}
