/**
 * Download and validate utilities for PieceCID pieces
 *
 * This module provides functions to download data from a Response object,
 * calculate PieceCID during streaming, and validate it matches the expected value.
 */

import type { PieceCID } from './index.ts'
import { asPieceCID, createPieceCIDStream } from './index.ts'

/**
 * Download data from a Response object, validate its PieceCID, and return as Uint8Array
 *
 * This function:
 * 1. Streams data from the Response body
 * 2. Calculates PieceCID during streaming
 * 3. Collects all chunks into a Uint8Array
 * 4. Validates the calculated PieceCID matches the expected value
 *
 * @param response - The Response object from a fetch() call
 * @param expectedPieceCid - The expected PieceCID to validate against
 * @returns The downloaded data as a Uint8Array
 * @throws Error if PieceCID validation fails or download errors occur
 *
 * @example
 * ```typescript
 * const response = await fetch(url)
 * const data = await downloadAndValidate(response, 'bafkzcib...')
 * ```
 */
export async function downloadAndValidate(
  response: Response,
  expectedPieceCid: string | PieceCID
): Promise<Uint8Array> {
  // Parse and validate the expected PieceCID
  const parsedPieceCid = asPieceCID(expectedPieceCid)
  if (parsedPieceCid == null) {
    throw new Error(`Invalid PieceCID: ${String(expectedPieceCid)}`)
  }

  // Check response is OK
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  if (response.body == null) {
    throw new Error('Response body is null')
  }

  // Create PieceCID calculation stream
  const { stream: pieceCidStream, getPieceCID } = createPieceCIDStream()

  // Create a stream that collects all chunks into an array
  const chunks: Uint8Array[] = []
  const collectStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      chunks.push(chunk)
      controller.enqueue(chunk)
    },
  })

  // Pipe the response through both streams
  const pipelineStream = response.body.pipeThrough(pieceCidStream).pipeThrough(collectStream)

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

  // Get the calculated PieceCID
  const calculatedPieceCid = getPieceCID()
  if (calculatedPieceCid == null) {
    throw new Error('Failed to calculate PieceCID from stream')
  }

  // Verify the PieceCID
  if (calculatedPieceCid.toString() !== parsedPieceCid.toString()) {
    throw new Error(
      `PieceCID verification failed. Expected: ${String(parsedPieceCid)}, Got: ${String(calculatedPieceCid)}`
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
 * Download data from a URL, validate its PieceCID, and return as Uint8Array
 *
 * This is a convenience function that fetches from a URL and then uses
 * downloadAndValidate to download and validate the data.
 *
 * @param url - The URL to download from
 * @param expectedPieceCid - The expected PieceCID to validate against
 * @returns The downloaded data as a Uint8Array
 * @throws Error if PieceCID validation fails or download errors occur
 *
 * @example
 * ```typescript
 * const data = await downloadAndValidateFromUrl(
 *   'https://provider.com/piece/bafkzcib...',
 *   'bafkzcib...'
 * )
 * ```
 */
export async function downloadAndValidateFromUrl(
  url: string,
  expectedPieceCid: string | PieceCID
): Promise<Uint8Array> {
  const response = await fetch(url)
  return await downloadAndValidate(response, expectedPieceCid)
}
