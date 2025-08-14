/**
 * Download and validate utilities for PieceLink pieces
 *
 * This module provides functions to download data from a Response object,
 * calculate PieceLink during streaming, and validate it matches the expected value.
 */

import type { PieceLink } from './index.js'
import { asPieceLink, createPieceLinkStream } from './index.js'

/**
 * Download data from a Response object, validate its PieceLink, and return as Uint8Array
 *
 * This function:
 * 1. Streams data from the Response body
 * 2. Calculates PieceLink during streaming
 * 3. Collects all chunks into a Uint8Array
 * 4. Validates the calculated PieceLink matches the expected value
 *
 * @param response - The Response object from a fetch() call
 * @param expectedPieceLink - The expected PieceLink to validate against
 * @returns The downloaded data as a Uint8Array
 * @throws Error if PieceLink validation fails or download errors occur
 *
 * @example
 * ```typescript
 * const response = await fetch(url)
 * const data = await downloadAndValidatePieceLink(response, 'baga6ea4seaq...')
 * ```
 */
export async function downloadAndValidatePieceLink (
  response: Response,
  expectedPieceLink: string | PieceLink
): Promise<Uint8Array> {
  // Parse and validate the expected PieceLink
  const parsedPieceLink = asPieceLink(expectedPieceLink)
  if (parsedPieceLink == null) {
    throw new Error(`Invalid PieceLink: ${String(expectedPieceLink)}`)
  }

  // Check response is OK
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  if (response.body == null) {
    throw new Error('Response body is null')
  }

  // Create PieceLink calculation stream
  const { stream: pieceLinkStream, getPieceLink } = createPieceLinkStream()

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
    .pipeThrough(pieceLinkStream)
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

  // Get the calculated PieceLink
  const calculatedPieceLink = getPieceLink()
  if (calculatedPieceLink == null) {
    throw new Error('Failed to calculate PieceLink from stream')
  }

  // Verify the PieceLink
  if (calculatedPieceLink.toString() !== parsedPieceLink.toString()) {
    throw new Error(
      `PieceLink verification failed. Expected: ${String(parsedPieceLink)}, Got: ${String(calculatedPieceLink)}`
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
 * Download data from a URL, validate its PieceLink, and return as Uint8Array
 *
 * This is a convenience function that fetches from a URL and then uses
 * downloadAndValidatePieceLink to download and validate the data.
 *
 * @param url - The URL to download from
 * @param expectedPieceLink - The expected PieceLink to validate against
 * @returns The downloaded data as a Uint8Array
 * @throws Error if PieceLink validation fails or download errors occur
 *
 * @example
 * ```typescript
 * const data = await downloadAndValidatePieceLinkFromUrl(
 *   'https://provider.com/piece/baga6ea4seaq...',
 *   'baga6ea4seaq...'
 * )
 * ```
 */
export async function downloadAndValidatePieceLinkFromUrl (
  url: string,
  expectedPieceLink: string | PieceLink
): Promise<Uint8Array> {
  const response = await fetch(url)
  return await downloadAndValidatePieceLink(response, expectedPieceLink)
}
