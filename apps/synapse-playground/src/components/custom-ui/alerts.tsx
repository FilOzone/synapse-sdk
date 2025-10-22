import { AlertCircleIcon, CheckCircle2Icon, Hash } from 'lucide-react'
import { BaseError } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.tsx'
import { ExplorerLink } from '../explorer-link.tsx'

export function ErrorAlert({ error }: { error?: Error | null }) {
  if (!error) return null
  console.error(error)
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />

      <AlertTitle>{error instanceof BaseError ? error.name : 'Error'}</AlertTitle>
      <AlertDescription className="wrap-anywhere">
        {error instanceof BaseError ? (error.details ?? error.message) : error.message}
      </AlertDescription>
    </Alert>
  )
}

export function HashAlert({ hash }: { hash: string | null }) {
  if (!hash) return null
  return (
    <Alert variant="default">
      <Hash className="w-4 h-4" />
      <AlertTitle>Transaction Hash</AlertTitle>
      <AlertDescription>
        <ExplorerLink hash={hash} />
        <p>Waiting for confirmation...</p>
      </AlertDescription>
    </Alert>
  )
}

export function SuccessAlert({ message, show }: { message: string; show?: boolean }) {
  if (!show) return null
  return (
    <Alert variant="default">
      <CheckCircle2Icon className="w-4 h-4" />
      <AlertTitle>Success</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
      </AlertDescription>
    </Alert>
  )
}
