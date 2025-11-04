import { getChain } from '@filoz/synapse-core/chains'
import { ArrowUpRightIcon } from 'lucide-react'
import { useConfig } from 'wagmi'

/**
 * Displays a link to the explorer for a given hash
 */
export function ExplorerLink({ hash }: { hash: string }) {
  const config = useConfig()
  const { blockExplorers } = getChain(config.state.chainId)
  const explorer = blockExplorers?.default?.url ?? ''
  const explorerUrl = `${explorer}/tx/${hash}`
  return (
    <a className="hover:underline wrap-anywhere" href={explorerUrl} rel="noopener noreferrer" target="_blank">
      {hash} <ArrowUpRightIcon className="w-4 h-4 inline-block" />
    </a>
  )
}
