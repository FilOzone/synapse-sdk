import { ArrowUpRightIcon, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty.tsx'
import { ConnectWallet } from './connect-wallet.tsx'
export function ConnectSection() {
  return (
    <div>
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Wallet />
          </EmptyMedia>
          <EmptyTitle>Synapse Playground</EmptyTitle>
          <EmptyDescription>Connect your wallet to get started.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <ConnectWallet />
          </div>
        </EmptyContent>
        <Button asChild className="text-muted-foreground" size="sm" variant="link">
          <a href="https://synapse.filecoin.services" rel="noopener" target="_blank">
            Learn More <ArrowUpRightIcon />
          </a>
        </Button>
      </Empty>
    </div>
  )
}
