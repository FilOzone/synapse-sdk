import { formatFraction } from '@filoz/synapse-core/utils'
import { useAccountInfo, useApproveAllowance, useDeposit, useWithdraw } from '@filoz/synapse-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { parseEther } from 'viem'
import { useAccount } from 'wagmi'
import { z } from 'zod/v4'
import * as Icons from '@/components/icons.tsx'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx'
import { ErrorAlert, HashAlert, SuccessAlert } from './custom-ui/alerts.tsx'
import { ButtonLoading } from './custom-ui/button-loading.tsx'
import { DepositAndApproveDialog } from './payments/deposit-and-approve.tsx'
import { Button } from './ui/button.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog.tsx'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './ui/form.tsx'
import { Input } from './ui/input.tsx'

export function PaymentsAccount() {
  const { address } = useAccount()
  const { data: paymentsBalance } = useAccountInfo({
    address,
  })

  // const { data: erc20Balance } = erc20.useBalance({ address })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay Account</CardTitle>
        <CardDescription>Manage your payments account</CardDescription>
      </CardHeader>
      <CardContent>
        {/* <div className="flex flex-row gap-2 items-center">
          <span className="text-sm text-muted-foreground">Allowance:</span>
          <span className="text-sm font-bold">
            {formatBalance({
              value: erc20Balance?.allowance,
            })}
          </span>
          <Icons.Usdfc className="w-4 h-4" />
        </div> */}
        <div className="flex flex-row gap-2 items-center">
          <span className="text-sm text-muted-foreground">Available Balance:</span>
          <span className="text-sm font-bold">
            {formatFraction({
              value: paymentsBalance?.availableFunds,
            })}
          </span>
          <Icons.Usdfc className="w-4 h-4" />
        </div>
        <div className="flex flex-row gap-2 items-center">
          <span className="text-sm text-muted-foreground">Balance:</span>
          <span className="text-sm font-bold">
            {formatFraction({
              value: paymentsBalance?.funds,
            })}
          </span>
          <Icons.Usdfc className="w-4 h-4" />
        </div>
        <div className="flex flex-row gap-2 items-center">
          <span className="text-sm text-muted-foreground">Lockup:</span>
          <span className="text-sm font-bold">
            {formatFraction({
              value: paymentsBalance?.lockupCurrent,
            })}
          </span>
          <Icons.Usdfc className="w-4 h-4" />
        </div>
        <div className="flex flex-row gap-2 items-center">
          <span className="text-sm text-muted-foreground">Lockup Rate:</span>
          <span className="text-sm font-bold">
            {formatFraction({
              value: paymentsBalance?.lockupRate,
              digits: 12,
            })}
          </span>
          <Icons.Usdfc className="w-4 h-4" />
        </div>

        {/* <Card className="bg-neutral-700">
          <CardHeader>
            <CardTitle>Payments Rails</CardTitle>
            <CardDescription>
              Payments rails are used to send and receive payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col my-3 space-y-2">
              <Skeleton className="h-[50px] w-full rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
            <div className="flex flex-col my-4 space-y-2">
              <Skeleton className="h-[50px] w-full rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          </CardContent>
        </Card> */}
      </CardContent>
      <CardFooter className="flex-row gap-2">
        <DepositAndApproveDialog />
        {/* <AllowanceDialog /> */}
        {/* <DepositDialog /> */}
        <WithdrawDialog />
      </CardFooter>
    </Card>
  )
}

const formSchema = z.object({
  amount: z.string().min(1),
})
export function AllowanceDialog() {
  const [hash, setHash] = useState<string | null>(null)
  const {
    mutate: approve,
    isPending,
    isSuccess,
    error,
    reset,
  } = useApproveAllowance({
    onHash: (hash) => {
      setHash(hash)
    },
    mutation: {
      onSettled: () => {
        setHash(null)
      },
    },
  })

  const form = useForm<z.infer<typeof formSchema>>({
    defaultValues: {
      amount: '1',
    },
  })

  function onSubmit(values: z.infer<typeof formSchema>) {
    const amount = parseEther(values.amount)
    approve({ amount })
  }

  return (
    <Dialog
      onOpenChange={() => {
        reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>Allowance</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Manage Allowance</DialogTitle>
              <DialogDescription>
                Manage the allowance for the Payments contract to spend your USDFC tokens.
              </DialogDescription>
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
                      <FormDescription>Amount of USDFC to approve.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                  rules={{
                    required: 'Amount is required',
                    validate: (value) => {
                      const amount = parseEther(value)
                      if (amount < 0n) {
                        return 'Amount must be greater than 0'
                      }
                      return true
                    },
                  }}
                />
              </div>
              <HashAlert hash={hash} />
              <ErrorAlert error={error} />
              <SuccessAlert message="Allowance approved" show={isSuccess} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <ButtonLoading className="sm:w-24 w-full" loading={isPending} type="submit">
                Approve
              </ButtonLoading>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

const depositFormSchema = z.object({
  amount: z.string().min(1),
})
export function DepositDialog() {
  const [hash, setHash] = useState<string | null>(null)
  const {
    mutate: deposit,
    isPending,
    isSuccess,
    error,
    reset,
  } = useDeposit({
    onHash: (hash) => {
      setHash(hash)
    },
    mutation: {
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
      onOpenChange={() => {
        reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Deposit</Button>
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
                <Button variant="outline">Cancel</Button>
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

const withdrawFormSchema = z.object({
  amount: z.string().min(1),
})
export function WithdrawDialog() {
  const [hash, setHash] = useState<string | null>(null)
  const {
    mutate: withdraw,
    isPending,
    isSuccess,
    error,
    reset,
  } = useWithdraw({
    onHash: (hash) => {
      setHash(hash)
    },
    mutation: {
      onSettled: () => {
        setHash(null)
      },
    },
  })

  const form = useForm<z.infer<typeof withdrawFormSchema>>({
    defaultValues: {
      amount: '1',
    },
  })

  function onSubmit(values: z.infer<typeof withdrawFormSchema>) {
    const amount = parseEther(values.amount)
    withdraw({ amount })
  }

  return (
    <Dialog
      onOpenChange={() => {
        reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Withdraw</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Withdraw USDFC</DialogTitle>
              <DialogDescription>Withdraw USDFC tokens from the Payments contract.</DialogDescription>
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
                      <FormDescription>Amount of USDFC to withdraw.</FormDescription>
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
              <SuccessAlert message="USDFC withdrawn" show={isSuccess} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <ButtonLoading className="sm:w-24 w-full" loading={isPending} type="submit">
                Withdraw
              </ButtonLoading>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
