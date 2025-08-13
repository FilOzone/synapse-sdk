/**
 * Download and validate utilities for CommP pieces
 *
 * This module provides functions to download data from a Response object,
 * calculate CommP during streaming, and validate it matches the expected value.
 */

import type { CommP, CommPv2 } from './commp.js'
import { asCommP, createCommPStream } from './commp.js'

/**
 * Download data from a Response object, validate its CommP, and return as Uint8Array
 *
 * This function:
 * 1. Streams data from the Response body
 * 2. Calculates CommP during streaming
 * 3. Collects all chunks into a Uint8Array
 * 4. Validates the calculated CommP matches the expected value
 *
 * @param response - The Response object from a fetch() call
 * @param expectedCommP - The expected CommP to validate against
 * @returns The downloaded data as a Uint8Array
 * @throws Error if CommP validation fails or download errors occur
 *
 * @example
 * ```typescript
 * const response = await fetch(url)
 * const data = await downloadAndValidateCommP(response, 'baga6ea4seaq...')
 * ```
 */
export async function downloadAndValidateCommP (
  response: Response,
  expectedCommP: string | CommP | CommPv2
): Promise<Uint8Array> {
  // Parse and validate the expected CommP
  const parsedCommP = asCommP(expectedCommP)
  if (parsedCommP == null) {
    throw new Error(`Invalid CommP: ${String(expectedCommP)}`)
  }

  // Check response is OK
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  if (response.body == null) {
    throw new Error('Response body is null')
  }

  // Create CommP calculation stream
  const { stream: commpStream, getCommP } = createCommPStream()

  // Create a stream that collects all chunks into an array
  const chunks: Uint8Array[] = []
  const collectStream = new TransformStream<Uint8Array, Uint8Array>({
    transform (chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      chunks.push(chunk)
      controller.enqueue(chunk)
    }
  })

  // Pipe the response through both streams
  const pipelineStream = response.body
    .pipeThrough(commpStream)
    .pipeThrough(collectStream)

  // Consume the stream to completion
  const reader = pipelineStream.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }

  // Get the calculated CommP
  const calculatedCommP = getCommP()
  if (calculatedCommP == null) {
    throw new Error('Failed to calculate CommP from stream')
  }

  // Verify the CommP
  if (calculatedCommP.toString() !== parsedCommP.toString()) {
    throw new Error(
      `CommP verification failed. Expected: ${String(parsedCommP)}, Got: ${String(calculatedCommP)}`
    )
  }

  // Combine all chunks into a single Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

/**
 * Download data from a URL, validate its CommP, and return as Uint8Array
 *
 * This is a convenience function that fetches from a URL and then uses
 * downloadAndValidateCommP to download and validate the data.
 *
 * @param url - The URL to download from
 * @param expectedCommP - The expected CommP to validate against
 * @returns The downloaded data as a Uint8Array
 * @throws Error if CommP validation fails or download errors occur
 *
 * @example
 * ```typescript
 * const data = await downloadAndValidateCommPFromUrl(
 *   'https://provider.com/piece/baga6ea4seaq...',
 *   'baga6ea4seaq...'
 * )
 * ```
 */
export async function downloadAndValidateCommPFromUrl (
  url: string,
  expectedCommP: string | CommP
): Promise<Uint8Array> {
  const response = await fetch(url)
  return await downloadAndValidateCommP(response, expectedCommP)
}
