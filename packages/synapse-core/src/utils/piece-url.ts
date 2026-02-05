import type { Address } from 'viem'
import type { Chain } from '../chains.ts'

export function createPieceUrl(cid: string, cdn: boolean, address: Address, chain: Chain, pdpUrl: string) {
  if (cdn) {
    if (chain.filbeam != null) {
      const endpoint = `https://${address}.${chain.filbeam.retrievalDomain}`
      const url = new URL(`/${cid}`, endpoint)
      return url.toString()
    }
    console.warn(
      `CDN retrieval is not available for chain ${chain.id} (${chain.name}). Falling back to direct retrieval via the storage provider.`
    )
  }

  return createPieceUrlPDP(cid, pdpUrl)
}

/**
 * Create a piece URL for the PDP API
 *
 * @param cid - The PieceCID identifier
 * @param pdpUrl - The PDP URL
 * @returns The PDP URL for the piece
 *
 * @example
 * ```ts
 * const pdpUrl = 'https://pdp.example.com'
 * const cid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
 * const pieceUrl = createPieceUrlPDP(cid, pdpUrl)
 * console.log(pieceUrl) // https://pdp.example.com/piece/bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
 * ```
 */
export function createPieceUrlPDP(cid: string, pdpUrl: string) {
  const endpoint = pdpUrl
  const url = `piece/${cid}`
  return new URL(url, endpoint).toString()
}
