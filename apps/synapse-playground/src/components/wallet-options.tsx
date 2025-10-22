import { useFilsnap } from '@filoz/synapse-react'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { type Connector, useConnect } from 'wagmi'
import { filecoin, filecoinCalibration } from 'wagmi/chains'
import { store } from '@/lib/store.ts'
import { Button } from './ui/button.tsx'

export function WalletOptions() {
  const { connectors, connect } = useConnect()
  const { network } = useStore(store, { keys: ['network'] })
  useFilsnap({
    // force: true,
  })

  return connectors.map((connector) => {
    if (connector.id === 'injected') {
      return null
    }
    return (
      <WalletOption
        connector={connector}
        key={connector.uid}
        onClick={() => {
          connect({
            connector,
            chainId: network === 'mainnet' ? filecoin.id : filecoinCalibration.id,
          })
        }}
      />
    )
  })
}

function WalletOption({ connector, onClick }: { connector: Connector; onClick: () => void }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    ;(async () => {
      const provider = await connector.getProvider()
      setReady(!!provider)
    })()
  }, [connector])

  return (
    <Button disabled={!ready} onClick={onClick} type="button">
      {connector.name}
    </Button>
  )
}
