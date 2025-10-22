import type { AbiError } from 'abitype'
import { AbiErrorSignatureNotFoundError, decodeErrorResult } from 'viem'
import { formatAbiItem, formatAbiItemWithArgs } from 'viem/utils'
import * as Abis from '../abis/index.ts'

export function decodePDPError(error: string) {
  const regex = /error=\[(.*?)]/
  const match = error.match(regex)
  const extractedContent = match?.[1]

  if (extractedContent?.startsWith('0x')) {
    let error: Error

    // try warm storage abi
    try {
      const value = decodeErrorResult({
        abi: Abis.storage,
        data: extractedContent as `0x${string}`,
      })

      return `Warm Storage\n${formatPDPError(value)}`
    } catch (err) {
      error = err as Error
    }

    // try payments abi
    if (error instanceof AbiErrorSignatureNotFoundError) {
      try {
        const value = decodeErrorResult({
          abi: Abis.payments,
          data: extractedContent as `0x${string}`,
        })

        return `Payments\n${formatPDPError(value)}`
      } catch (err) {
        error = err as Error
      }
    }

    // try pdp verifier abi
    if (error instanceof AbiErrorSignatureNotFoundError) {
      try {
        const value = decodeErrorResult({
          abi: Abis.pdp,
          data: extractedContent as `0x${string}`,
        })

        return `PDP Verifier\n${formatPDPError(value)}`
      } catch (err) {
        error = err as Error
      }
    }

    return `Unable to decode error\n${error}`
  } else if (extractedContent?.startsWith('Error(')) {
    return `\n${extractedContent.replace('Error(', '').replace(')', '')}`
  } else {
    return `Curio PDP\n${error}`
  }
}

/**
 * Format the PDP error for display, stringifies the error and adds the inputs and args
 *
 * @param error - The PDP error to format
 */
function formatPDPError(error: { abiItem: AbiError; args: readonly unknown[] | undefined; errorName: string }) {
  const errorWithParams = error.abiItem
    ? formatAbiItem(error.abiItem, {
        includeName: true,
      })
    : undefined
  const formattedArgs = error.args
    ? formatAbiItemWithArgs({
        abiItem: error.abiItem,
        args: error.args,
        includeName: false,
        includeFunctionName: false,
      })
    : undefined

  return [
    errorWithParams ? `Error: ${errorWithParams}` : '',
    formattedArgs && formattedArgs !== '()'
      ? `       ${[...Array(error.errorName?.length ?? 0).keys()].map(() => ' ').join('')}${formattedArgs}`
      : '',
  ].join('\n')
}
