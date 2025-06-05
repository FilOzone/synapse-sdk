/**
 * PDP Download Service for retrieving data from storage providers
 */

import type { CommP } from '../types.js'
import { asCommP, createCommPStream } from '../commp/index.js'

/**
 * PDPDownloadService handles retrieval of data from storage providers with CommP verification
 */
export class PDPDownloadService {
  private readonly retrievalUrl: string

  /**
   * Create a new PDPDownloadService instance
   * @param retrievalUrl - The retrieval endpoint for the storage provider (e.g., 'https://sp.example.com/retrieve')
   */
  constructor (retrievalUrl: string) {
    // Validate and normalize retrieval URL (remove trailing slash)
    if (retrievalUrl === '') {
      throw new Error('Retrieval URL is required')
    }
    this.retrievalUrl = retrievalUrl.endsWith('/') ? retrievalUrl.slice(0, -1) : retrievalUrl
  }

  /**
   * Download a piece from the storage provider and verify its CommP
   * @param commp - The CommP (piece commitment) to download
   * @returns The downloaded data as Uint8Array
   * @throws Error if download fails or CommP verification fails
   */
  async downloadPiece (commp: CommP | string): Promise<Uint8Array> {
    // Validate and normalize the CommP
    const normalizedCommP = asCommP(commp)
    if (normalizedCommP == null) {
      throw new Error('Invalid CommP provided')
    }

    // Construct the download URL
    const downloadUrl = `${this.retrievalUrl}/piece/${normalizedCommP.toString()}`

    // Download the data
    const response = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/octet-stream'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to download piece: ${response.status} ${response.statusText} - ${errorText}`)
    }

    // Ensure we have a body
    if (response.body == null) {
      throw new Error('Response body is null')
    }

    console.log('Streaming and verifying downloaded data...')

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
    if (calculatedCommP.toString() !== normalizedCommP.toString()) {
      throw new Error(
        `CommP verification failed. Expected: ${normalizedCommP.toString()}, Got: ${calculatedCommP.toString()}`
      )
    }

    console.log('✅ CommP verification successful')

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
   * Get the retrieval URL
   */
  getRetrievalUrl (): string {
    return this.retrievalUrl
  }
}
