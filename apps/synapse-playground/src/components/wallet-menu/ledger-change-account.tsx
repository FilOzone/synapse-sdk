import { isLedgerConnector } from '@filoz/synapse-react/ledger'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useConnection } from 'wagmi'
import { z } from 'zod/v4'
import { Button } from '@/components/ui/button.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form.tsx'
import { Input } from '@/components/ui/input.tsx'
import { DropdownMenuItem } from '../ui/dropdown-menu.tsx'

const withdrawFormSchema = z.object({
  addressIndex: z.number().min(0),
})
export function LedgerChangeAccountDialog() {
  const { connector } = useConnection()
  const [open, setOpen] = useState(false)
  const form = useForm<z.infer<typeof withdrawFormSchema>>({
    defaultValues: {
      addressIndex: 0,
    },
  })

  function onSubmit(values: z.infer<typeof withdrawFormSchema>) {
    if (isLedgerConnector(connector)) {
      connector.changeAccount({ addressIndex: values.addressIndex })
      setOpen(false)
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>Change Account</DropdownMenuItem>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Change Account</DialogTitle>
              <DialogDescription>Change the account to use with the Ledger device.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-3">
                <FormField
                  control={form.control}
                  name="addressIndex"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address Index</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormDescription>The index of the account to use with the Ledger device.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                  rules={{
                    required: 'Address Index is required',
                    validate: (value) => {
                      if (value < 0) {
                        return 'Address Index must be equal or greater than 0'
                      }
                      return true
                    },
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button className="sm:w-24 w-full" type="submit">
                Change
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
