import type { Address } from 'viem'
import type { Chain } from '../chains.ts'

export namespace createPieceUrl {
  export type OptionsType = {
    /** The PieceCID identifier. */
    cid: string
    /** Whether the CDN is enabled. */
    cdn: boolean
    /** The address of the user. */
    address: Address
    /** The chain. */
    chain: Chain
    /** The endpoint of the PDP API. */
    serviceURL: string
  }

  export type OutputType = string
}

/**
 * Create a piece URL for the CDN or PDP API
 * @param options - {@link createPieceUrl.OptionsType}
 * @returns The piece URL
 *
 * @example
 * ```ts
 * const pieceUrl = createPieceUrl({
 *   cid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
 *   cdn: true,
 *   address: '0x1234567890123456789012345678901234567890',
 *   chain: mainnet,
 *   serviceURL: 'https://pdp.example.com',
 * })
 * console.log(pieceUrl) // https://0x1234567890123456789012345678901234567890.mainnet.filbeam.io/bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
 * ```
 */
export function createPieceUrl(options: createPieceUrl.OptionsType) {
  const { cid, cdn, address, chain, serviceURL } = options
  if (cdn && chain.filbeam != null) {
    return new URL(`${cid}`, `https://${address}.${chain.filbeam.retrievalDomain}`).toString()
  }

  return createPieceUrlPDP({ cid, serviceURL })
}

export namespace createPieceUrlPDP {
  export type OptionsType = {
    /** The PieceCID identifier. */
    cid: string
    /** The PDP URL. */
    serviceURL: string
  }

  export type OutputType = string
}

/**
 * Create a piece URL for the PDP API
 *
 * @param options - {@link createPieceUrlPDP.OptionsType}
 * @returns The PDP URL
 *
 * @example
 * ```ts
 * const cid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
 * const pieceUrl = createPieceUrlPDP({ cid, serviceURL: 'https://pdp.example.com' })
 * console.log(pieceUrl) // https://pdp.example.com/piece/bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
 * ```
 */
export function createPieceUrlPDP(options: createPieceUrlPDP.OptionsType) {
  const { cid, serviceURL } = options
  return new URL(`piece/${cid}`, serviceURL).toString()
}
