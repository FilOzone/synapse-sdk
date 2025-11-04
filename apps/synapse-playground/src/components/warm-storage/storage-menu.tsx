import { formatFraction } from '@filoz/synapse-core/utils'
import { useOperatorApprovals, useRevokeOperator } from '@filoz/synapse-react'
import { EllipsisVertical } from 'lucide-react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { toastError } from '@/lib/utils.ts'
import { ExplorerLink } from '../explorer-link.tsx'
import { Button } from '../ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx'

export function StorageMenu() {
  const { address } = useAccount()
  const { data: operatorApprovals } = useOperatorApprovals({
    address,
  })

  const { mutate: revokeOperator } = useRevokeOperator({
    onHash: (hash) => {
      toast.loading('Revoking operator...', {
        description: <ExplorerLink hash={hash} />,
        id: 'approve-operator',
      })
    },
    mutation: {
      onSuccess: () => {
        toast.success('Operator revoked', {
          id: 'approve-operator',
        })
      },
      onError: (error) => {
        toastError(error, 'approve-operator', 'Operator Revocation Failed')
      },
    },
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Approvals</DropdownMenuLabel>
        <DropdownMenuLabel className="flex flex-row gap-2 items-center justify-between">
          <span>Rate</span>
          <span className="text-muted-foreground">
            {formatFraction({
              value: operatorApprovals?.rateUsed,
              digits: 12,
            })}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuLabel className="flex flex-row gap-2 items-center justify-between">
          <span>Lockup </span>
          <span className="text-muted-foreground">
            {formatFraction({
              value: operatorApprovals?.lockupUsed,
            })}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => revokeOperator()} variant="destructive">
          Revoke
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
