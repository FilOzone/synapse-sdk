import type { Chain } from '@filoz/synapse-core/chains'
import terminalLink from 'terminal-link'

export function hashLink(hash: string, chain: Chain) {
  const link = terminalLink(
    hash,
    `${chain.blockExplorers?.default?.url}/tx/${hash}`
  )
  return link
}
