import { Synapse, type UploadResult } from '@filoz/synapse-sdk'
import type { StorageManagerUploadOptions } from '@filoz/synapse-sdk/storage'
import { type MutateOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { useChainId, useConfig, useConnection } from 'wagmi'
import { getConnectorClient } from 'wagmi/actions'
import { assertSessionKey, type SessionKeySignerOptions } from '../signer.ts'

export interface UseUploadProps
  extends Omit<StorageManagerUploadOptions, 'contexts' | 'pieceMetadata'>,
    SessionKeySignerOptions {
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
  const { mutation, source, sessionKey, ...uploadOptions } = props

  return useMutation({
    ...mutation,
    mutationFn: async ({ file, metadata }: UseUploadVariables) => {
      const connectorClient = await getConnectorClient(config, {
        account: account.address,
        chainId,
      })

      // The connected wallet pays, so the session key must belong to it.
      if (sessionKey) {
        assertSessionKey(sessionKey, { account: connectorClient.account.address, chainId })
      }

      const synapse = new Synapse({
        client: connectorClient,
        sessionClient: sessionKey?.client,
        source,
      })

      const rsp = await synapse.storage.upload(new Uint8Array(await file.arrayBuffer()), {
        ...uploadOptions,
        pieceMetadata: metadata,
      })

      queryClient.invalidateQueries({
        queryKey: ['synapse-warm-storage-data-sets', connectorClient.account.address, chainId],
      })
      return rsp
    },
  })
}
