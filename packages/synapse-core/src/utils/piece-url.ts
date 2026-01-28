import type { Address } from 'viem'
import type { Chain } from '../chains.ts'

export function createPieceUrl(cid: string, cdn: boolean, address: Address, chain: Chain, pdpUrl: string) {
  if (cdn) {
    const endpoint = `https://${address}.${chain.filbeam.retrievalDomain}`
    const url = new URL(`/${cid}`, endpoint)
    return url.toString()
  } else {
    return createPieceUrlPDP(cid, pdpUrl)
  }
}

export function createPieceUrlPDP(cid: string, pdpUrl: string) {
  const endpoint = pdpUrl
  const url = `piece/${cid}`
  return new URL(url, endpoint).toString()
}
