import * as p from '@clack/prompts'
import type { Chain } from '@filoz/synapse-core/chains'
import terminalLink from 'terminal-link'

export function onCancel(message?: string) {
  p.cancel(message ?? 'Operation cancelled.')
  process.exit(0)
}

export function hashLink(hash: string, chain: Chain) {
  const link = terminalLink(
    hash,
    `${chain.blockExplorers?.default?.url}/tx/${hash}`
  )
  return link
}
