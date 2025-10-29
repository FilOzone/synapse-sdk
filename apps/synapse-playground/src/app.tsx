import { useAccount } from 'wagmi'
import * as Icons from '@/components/icons.tsx'
import { NetworkSelector } from '@/components/network-selector.tsx'
import { Toaster } from '@/components/ui/sonner.tsx'
import { ConnectSection } from './components/connect-section.tsx'
import { PaymentsAccount } from './components/payments-account.tsx'
import { Services } from './components/services.tsx'
import { WalletMenu } from './components/wallet-menu.tsx'

export function App() {
  const { isConnected } = useAccount()
  // const client = useClient()
  // if (client) {
  //   readAddresses(client).then((addresses) => {
  //     console.log(addresses)
  //   })
  // }
  return (
    <div>
      <header>
        <nav aria-label="Global" className="mx-auto flex max-w-7xl items-center justify-between p-6 lg:px-8">
          <div className="flex flex-row gap-2 items-center">
            <a className="" href="/">
              <Icons.Filecoin className="w-8 h-8" />
            </a>
            <span className="text-xl font-bold">Filecoin Onchain Cloud</span>
          </div>
          <div className="flex flex-row gap-2 items-center">
            {isConnected && <WalletMenu />}
            <NetworkSelector />
          </div>
        </nav>
      </header>
      <main>
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {isConnected && <PaymentsAccount />}
          {isConnected && <Services />}
          {!isConnected && <ConnectSection />}
        </div>
      </main>
      <Toaster richColors={true} theme="system" />
    </div>
  )
}
