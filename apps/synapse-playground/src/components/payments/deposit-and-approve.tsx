import { useDepositAndApprove } from '@filoz/synapse-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { parseEther } from 'viem'
import { z } from 'zod/v4'
import { ErrorAlert, HashAlert, SuccessAlert } from '../custom-ui/alerts.tsx'
import { ButtonLoading } from '../custom-ui/button-loading.tsx'
import { Button } from '../ui/button.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog.tsx'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '../ui/form.tsx'
import { Input } from '../ui/input.tsx'

const depositFormSchema = z.object({
  amount: z.string().min(1),
})
export function DepositAndApproveDialog() {
  const [hash, setHash] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const {
    mutate: deposit,
    isPending,
    isSuccess,
    error,
    reset,
  } = useDepositAndApprove({
    onHash: (hash) => {
      setHash(hash)
    },
    mutation: {
      onSuccess: () => {
        setOpen(false)
      },
      onSettled: () => {
        setHash(null)
      },
    },
  })

  const form = useForm<z.infer<typeof depositFormSchema>>({
    defaultValues: {
      amount: '1',
    },
  })

  function onSubmit(values: z.infer<typeof depositFormSchema>) {
    const amount = parseEther(values.amount)
    deposit({ amount })
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        setOpen(open)
        reset()
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button>Deposit</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Deposit USDFC</DialogTitle>
              <DialogDescription>Deposit USDFC tokens to the Payments contract.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-3">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormDescription>Amount of USDFC to deposit.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                  rules={{
                    required: 'Amount is required',
                    validate: (value) => {
                      const amount = parseEther(value)
                      if (amount <= 0n) {
                        return 'Amount must be greater than 0'
                      }
                      return true
                    },
                  }}
                />
              </div>
              <HashAlert hash={hash} />
              <ErrorAlert error={error} />
              <SuccessAlert message="USDFC deposited" show={isSuccess} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <ButtonLoading className="sm:w-24 w-full" loading={isPending} type="submit">
                Deposit
              </ButtonLoading>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
