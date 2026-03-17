import { asClient } from '@filoz/synapse-core/chains'
import { Synapse, type UploadResult } from '@filoz/synapse-sdk'
import type { StorageManagerUploadOptions } from '@filoz/synapse-sdk/storage'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChainId, useConfig, useConnection } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'

export interface UseUploadProps extends Omit<StorageManagerUploadOptions, 'contexts' | 'pieceMetadata'> {
  source: string | null
  mutation?: Omit<MutateOptions<UploadResult, Error, UseUploadVariables>, 'mutationFn'>
}

export interface UseUploadVariables {
  file: File
  metadata?: Record<string, string>
}
export function useUpload(props: UseUploadProps) {
  const config = useConfig()
  const chainId = useChainId({ config })
  const account = useConnection({ config })
  const queryClient = useQueryClient()

  return useMutation({
    ...props?.mutation,
    mutationFn: async ({ file, metadata }: UseUploadVariables) => {
      const connectorClient = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      const synapse = new Synapse({
        client: asClient(connectorClient),
        source: props.source,
      })

      const rsp = await synapse.storage.upload(new Uint8Array(await file.arrayBuffer()), {
        ...props,
        pieceMetadata: metadata,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', account.address, config.getClient().chain.id],
      })
      return rsp
    },
  })
}
