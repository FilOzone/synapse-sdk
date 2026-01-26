import { getChain } from '@filoz/synapse-core/chains'
import { accounts, deposit, operatorApprovals, setOperatorApproval, withdraw } from '@filoz/synapse-core/pay'
import {
  type MutateOptions,
  skipToken,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { SetOptional } from 'type-fest'
import type { Address, TransactionReceipt } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { useAccount, useBlock, useChainId, useConfig, useConnection } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseAccountInfoProps extends SetOptional<accounts.OptionsType, 'address'> {
  /**
   * Whether to watch blocks.
   * @default false
   */
  watch?: boolean
  query?: Omit<UseQueryOptions<accounts.OutputType>, 'queryKey' | 'queryFn'>
}

/**
 * Get the account info from the payments contract.
 *
 * @param props - The props for the balance.
 * @param props.address - The address of the account to get the balance for.
 * @param props.token - The address of the ERC20 token to query.
 * @param props.watch - Whether to watch blocks.
 * @param props.query - The query options.
 * @returns The account info including funds, lockup details, and available balance.
 */
export function useAccountInfo(props?: UseAccountInfoProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const token = props?.token ?? chain.contracts.usdfc.address
  const owner = props?.address
  const { data } = useBlock({
    blockTag: 'latest',
    chainId,
    watch: props?.watch ?? false,
  })

  const result = useQuery({
    ...props?.query,
    queryKey: ['synapse-payments-account-info', owner, token, data?.number?.toString()],
    queryFn: owner
      ? async () => {
          return await accounts(config.getClient(), {
            token,
            address: owner,

            blockNumber: data?.number,
          })
        }
      : skipToken,
  })
  return result
}

export interface UseOperatorApprovalsProps extends SetOptional<operatorApprovals.OptionsType, 'address'> {
  query?: Omit<UseQueryOptions<operatorApprovals.OutputType>, 'queryKey' | 'queryFn'>
}

/**
 * Get the operator approvals from the payments contract.
 *
 * @param props - The props for the balance.
 * @returns The operator approvals.
 */
export function useOperatorApprovals(props?: UseOperatorApprovalsProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const token = props?.token ?? chain.contracts.usdfc.address
  const operator = props?.operator ?? chain.contracts.storage.address
  const address = props?.address

  const result = useQuery({
    ...props?.query,
    queryKey: ['synapse-payments-operator-approvals', address, token, operator],
    queryFn: address
      ? async () => {
          return await operatorApprovals(config.getClient(), {
            token,
            address,
            operator,
          })
        }
      : skipToken,
  })
  return result
}

export type UseDepositVariables = Pick<deposit.OptionsType, 'amount'>
export interface UseDepositProps extends Omit<deposit.OptionsType, 'amount'> {
  /**
   * The mutation options.
   */
  mutation?: Omit<MutateOptions<TransactionReceipt, Error, UseDepositVariables>, 'mutationFn'>
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
}

/**
 * Deposit ERC20 tokens into the payments contract.
 *
 * @param props - The props for the deposit. {@link UseDepositProps}
 * @returns The deposit mutation.
 */
export function useDeposit(props?: UseDepositProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const account = useConnection({ config })
  const queryClient = useQueryClient()
  const token = props?.token ?? chain.contracts.usdfc.address
  const to = props?.to ?? account.address

  return useMutation({
    mutationFn: async ({ amount }: UseDepositVariables) => {
      const client = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      const hash = await deposit(client, {
        amount,
        to,
        token,
        contractAddress: props?.contractAddress,
      })

      props?.onHash?.(hash)
      const transactionReceipt = await waitForTransactionReceipt(config.getClient(), {
        hash: hash,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-account-info', to, token],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-erc20-balance', to, token],
      })
      return transactionReceipt
    },
    ...props?.mutation,
  })
}

export type UseWithdrawVariables = Pick<withdraw.OptionsType, 'amount'>
export type UseWithdrawProps = Omit<withdraw.OptionsType, 'amount'> & {
  mutation?: Omit<MutateOptions<TransactionReceipt, Error, UseWithdrawVariables>, 'mutationFn'>
  onHash?: (hash: string) => void
}
/**
 * Withdraw ERC20 tokens from the payments contract.
 *
 * @param props - The props for the withdraw.
 * @returns The withdraw mutation.
 */
export function useWithdraw(props?: UseWithdrawProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const account = useConnection({ config })
  const queryClient = useQueryClient()
  const token = props?.token ?? chain.contracts.usdfc.address

  return useMutation({
    mutationFn: async ({ amount }: UseWithdrawVariables) => {
      const client = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      const hash = await withdraw(client, {
        amount,
        token,
      })
      props?.onHash?.(hash)
      const transactionReceipt = await waitForTransactionReceipt(config.getClient(), {
        hash,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-account-info', account.address, token],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-erc20-balance', account.address, token],
      })
      return transactionReceipt
    },
    ...props?.mutation,
  })
}

export type ApproveOperatorProps =
  | {
      /**
       * The address of the operator to approve.
       * If not provided, the operator will be the Warm Storage contract.
       */
      operator?: Address
      /**
       * The address of the ERC20 token to query.
       * If not provided, the USDFC token address will be used.
       */
      token?: Address
      /**
       * The mutation options.
       */
      mutation?: Omit<MutateOptions<TransactionReceipt, Error>, 'mutationFn'>
      onHash?: (hash: string) => void
    }
  | undefined

/**
 * Approve a service contract to act as an operator for payment rails.
 *
 * @param props - The props for the deposit. {@link ApproveOperatorProps}
 * @returns The deposit mutation.
 */
export function useApproveOperator(props?: ApproveOperatorProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  const token = props?.token ?? chain.contracts.usdfc.address
  const operator = props?.operator ?? chain.contracts.storage.address

  return useMutation({
    ...props?.mutation,
    mutationFn: async () => {
      const client = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })
      const hash = await setOperatorApproval(client, {
        token: props?.token,
        operator: props?.operator,
        approve: true,
      })

      props?.onHash?.(hash)
      const transactionReceipt = await waitForTransactionReceipt(config.getClient(), {
        hash,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-operator-approvals', account.address, token, operator],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-account-info', account.address, token],
      })

      return transactionReceipt
    },
  })
}

export type RevokeOperatorProps =
  | {
      /**
       * The address of the operator to revoke.
       * If not provided, the operator will be the Warm Storage contract.
       */
      operator?: Address
      /**
       * The address of the ERC20 token to query.
       * If not provided, the USDFC token address will be used.
       */
      token?: Address
      /**
       * The mutation options.
       */
      mutation?: Omit<MutateOptions<TransactionReceipt, Error>, 'mutationFn'>
      /**
       * The callback to call when the hash is available.
       */
      onHash?: (hash: string) => void
    }
  | undefined

/**
 * Revoke the operator to deposit and withdraw ERC20 tokens from the payments contract.
 *
 * @param props - The props for the deposit. {@link RevokeOperatorProps}
 * @returns The deposit mutation.
 */
export function useRevokeOperator(props?: RevokeOperatorProps) {
  const config = useConfig()
  const configChainId = useChainId({ config })
  const chain = getChain(configChainId)
  const account = useAccount({ config })
  const queryClient = useQueryClient()
  const token = props?.token ?? chain.contracts.usdfc.address
  const operator = props?.operator ?? chain.contracts.storage.address

  return useMutation({
    ...props?.mutation,
    mutationFn: async () => {
      const client = await getConnectorClient(config, {
        account: account.address,
        chainId: chain.id,
      })
      const hash = await setOperatorApproval(client, {
        token: props?.token,
        operator: props?.operator,
        approve: false,
      })
      props?.onHash?.(hash)
      const transactionReceipt = await waitForTransactionReceipt(config.getClient(), {
        hash,
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-operator-approvals', account.address, token, operator],
      })
      queryClient.invalidateQueries({
        queryKey: ['synapse-payments-account-info', account.address, token],
      })
      return transactionReceipt
    },
  })
}

export * from './use-deposit-and-approve.ts'
