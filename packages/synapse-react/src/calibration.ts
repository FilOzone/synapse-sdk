import { getChain } from '@filoz/synapse-core/chains'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TransactionReceipt } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import { useChainId, useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

interface UseFundWalletProps {
  /**
   * The mutation options.
   */
  mutation?: Omit<MutateOptions<TransactionReceipt, Error>, 'mutationFn'>
  /**
   * The callback to call when the hash is available.
   */
  onHash?: (hash: string) => void
}

/**
 * Fund the wallet with USDFC and FIL.
 *
 * @param props - The props for the fund wallet.
 * @param props.mutation - The mutation options.
 * @param props.onHash - The callback to call when the hash is available.
 * @returns
 */
export function useFundWallet(props?: UseFundWalletProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const chain = getChain(chainId)
  const publicClient = config.getClient()
  const queryClient = useQueryClient()
  const result = useMutation({
    ...props?.mutation,
    mutationFn: async () => {
      const client = await getConnectorClient(config)

      if (!chain.testnet) {
        throw new Error('Wallet funding is only available on testnet')
      }

      const responses = await Promise.all([
        fetch(
          `https://forest-explorer.chainsafe.dev/api/claim_token?faucet_info=CalibnetUSDFC&address=${client.account.address}`
        ),
        fetch(
          `https://forest-explorer.chainsafe.dev/api/claim_token?faucet_info=CalibnetFIL&address=${client.account.address}`
        ),
      ])

      const hashes = await Promise.all(responses.filter((response) => response.ok).map((response) => response.json()))

      props?.onHash?.(hashes[0] as `0x${string}`)

      const wait = await waitForTransactionReceipt(publicClient, {
        hash: hashes[0] as `0x${string}`,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-erc20-balance', client.account.address, chain.contracts.usdfc.address],
      })

      queryClient.invalidateQueries({
        queryKey: [
          'balance',
          {
            address: client.account.address,
            chainId,
          },
        ],
      })
      return wait
    },
  })
  return result
}
