import { useConfig } from 'wagmi'

/**
 * Displays a link to the explorer for a given hash
 */
export function PDPDatasetLink({ id }: { id: string }) {
  const config = useConfig()
  const chain = config.state.chainId === 314 ? 'mainnet' : 'calibration'
  const explorerUrl = `https://pdp.vxb.ai/${chain}/dataset/${id}`
  return (
    <a
      className="hover:underline wrap-anywhere text-gray-400"
      href={explorerUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      #{id}
    </a>
  )
}

export function PDPProviderLink({ address, name }: { address: string; name: string }) {
  const config = useConfig()
  const chain = config.state.chainId === 314 ? 'mainnet' : 'calibration'
  const explorerUrl = `https://pdp.vxb.ai/${chain}/providers/${address}`
  return (
    <a
      className="hover:underline wrap-anywhere text-gray-400"
      href={explorerUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      {name}
    </a>
  )
}

export function PDPPieceLink({ cid, name }: { cid: string; name?: string }) {
  const config = useConfig()
  const chain = config.state.chainId === 314 ? 'mainnet' : 'calibration'
  const explorerUrl = `https://pdp.vxb.ai/${chain}/piece/${cid}`
  return (
    <a className="hover:underline wrap-anywhere" href={explorerUrl} rel="noopener noreferrer" target="_blank">
      {name || cid}
    </a>
  )
}
