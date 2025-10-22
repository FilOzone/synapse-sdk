import { useApproveOperator } from '@filoz/synapse-react'
import { toast } from 'sonner'
import { toastError } from '@/lib/utils.ts'
import { ButtonLoading } from '../custom-ui/button-loading.tsx'
import { ExplorerLink } from '../explorer-link.tsx'

export function StorageApproveButton() {
  // Approve Operator Mutation
  const { mutate: approveOperator, isPending } = useApproveOperator({
    onHash: (hash) => {
      toast.loading('Approving operator...', {
        description: <ExplorerLink hash={hash} />,
        id: 'approve-operator',
      })
    },
    mutation: {
      onSuccess: () => {
        toast.success('Operator approved', {
          id: 'approve-operator',
        })
      },
      onError: (error) => {
        toastError(error, 'approve-operator', 'Operator Approval Failed')
      },
    },
  })

  return (
    <ButtonLoading className="w-full" loading={isPending} onClick={() => approveOperator()} variant="default">
      Approve
    </ButtonLoading>
  )
}
