import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { filecoin, filecoinCalibration } from 'wagmi/chains'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { store } from '@/lib/store.ts'

export function NetworkSelector() {
  const { network } = useStore(store, { keys: ['network'] })
  const { chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  // update the network in the store when the chainId changes
  useEffect(() => {
    if (chainId === filecoin.id) {
      store.setKey('network', 'mainnet')
    } else if (chainId === filecoinCalibration.id) {
      store.setKey('network', 'calibration')
    }
  }, [chainId])

  return (
    <Select
      onValueChange={(value) => {
        if (value === 'mainnet') {
          return
        }
        // store.setKey('network', value as 'mainnet' | 'calibration')
        switchChain({
          chainId: value === 'mainnet' ? filecoin.id : filecoinCalibration.id,
        })
      }}
      value={network}
    >
      <SelectTrigger className="w-[120px]">
        <SelectValue placeholder="Network" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="mainnet">Mainnet (soon)</SelectItem>
        <SelectItem value="calibration">Calibration</SelectItem>
      </SelectContent>
    </Select>
  )
}
