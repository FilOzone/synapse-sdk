import type { Address } from 'viem'

export function createPieceUrl(cid: string, cdn: boolean, address: Address, chainId: number, pdpUrl: string) {
  if (cdn) {
    const endpoint = chainId === 314 ? `https://${address}.filbeam.io` : `https://${address}.calibration.filbeam.io`

    const url = new URL(`/${cid}`, endpoint)
    return url.toString()
  } else {
    return createPieceUrlPDP(cid, pdpUrl)
  }
}

function createPieceUrlPDP(cid: string, pdpUrl: string) {
  const endpoint = pdpUrl
  const url = `piece/${cid}`
  return new URL(url, endpoint).toString()
}
