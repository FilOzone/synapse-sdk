import { watchUsdfc } from '@filoz/synapse-core/usdfc'
import { type MutateOptions, useMutation } from '@tanstack/react-query'
import { useConfig } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseWatchUsdfcProps {
  mutation?: Omit<MutateOptions<boolean, Error>, 'mutationFn'>
}

/**
 * Add the USDFC token to the wallet.
 *
 * @param props - The props for the add USDFC.
 * @param props.mutation - The mutation options.
 */
export function useAddUsdfc(props?: UseWatchUsdfcProps) {
  const config = useConfig()

  return useMutation({
    ...props?.mutation,
    mutationFn: async () => {
      const client = await getConnectorClient(config)
      return await watchUsdfc(client)
    },
  })
}
