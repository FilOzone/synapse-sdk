import { formatBalance } from '@filoz/synapse-core/utils'
import { useAddUsdfc, useERC20Balance, useFundWallet } from '@filoz/synapse-react'
import { ArrowUpRight, Copy, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useAccount, useBalance, useDisconnect } from 'wagmi'
import * as Icons from '@/components/icons.tsx'
import { Button } from '@/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx'
import { useCopyToClipboard } from '@/hooks/use-clipboard.ts'
import { toastError, truncateMiddle } from '@/lib/utils.ts'
import { ExplorerLink } from './explorer-link.tsx'

export function WalletMenu() {
  const { address } = useAccount()
  const { disconnect } = useDisconnect()
  const [_, copyToClipboard] = useCopyToClipboard()
  const { data: balance } = useBalance({
    address,
  })

  const { mutate: addUsdfc } = useAddUsdfc()
  const { data: erc20Balance } = useERC20Balance({ address })
  const { mutate: fundWallet } = useFundWallet({
    mutation: {
      onSuccess: () => {
        toast.success('Funded wallet', {
          id: 'fund-wallet',
        })
      },
      onError: (error) => {
        toastError(error, 'fund-wallet', 'Funding wallet failed')
      },
    },
    onHash: (hash) => {
      toast.loading('Funding wallet...', {
        description: <ExplorerLink hash={hash} />,
        id: 'fund-wallet',
      })
    },
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="default" variant="outline">
          {formatBalance({
            value: balance?.value,
            digits: 1,
          })}
          <Icons.Filecoin />
          {formatBalance({
            value: erc20Balance?.value,
            digits: 1,
          })}
          <Icons.Usdfc />
          <Wallet />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Wallet</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => copyToClipboard(address ?? '')}>
            {truncateMiddle(address ?? '', 7, 5)}
            <DropdownMenuShortcut>
              <Copy />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            {formatBalance(balance)} {balance?.symbol}
            <DropdownMenuShortcut>
              <Icons.Filecoin />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            {formatBalance(erc20Balance)} {erc20Balance?.symbol}
            <DropdownMenuShortcut>
              <Icons.Usdfc />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tools</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              addUsdfc()
            }}
          >
            Add USDFC Token
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fundWallet()}>
            {/* <a
              href="https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc"
              rel="noopener noreferrer"
              target="_blank"
            > */}
            Fund Wallet
            {/* </a> */}
          </DropdownMenuItem>
          <DropdownMenuItem>
            <a href="https://synapse.filecoin.services" rel="noopener noreferrer" target="_blank">
              Docs
            </a>
            <DropdownMenuShortcut>
              <ArrowUpRight />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => disconnect()}>Disconnect</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
