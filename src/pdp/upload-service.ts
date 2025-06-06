/**
 * PDP Service for uploading data to a remote PDP server
 */

import { toHex } from 'multiformats/bytes'
import type { CommP } from '../types.js'
import { MULTIHASH_CODES } from '../utils/index.js'

/**
 * PDPUploadService handles communication with a remote PDP server for data uploads
 */
export class PDPUploadService {
  private readonly apiEndpoint: string
  private readonly serviceName: string

  /**
   * Create a new PDPUploadService instance
   * @param apiEndpoint - The root URL of the PDP API endpoint (e.g., 'https://pdp.example.com')
   * @param serviceName - The name of the PDP service (defaults to 'public')
   */
  constructor (apiEndpoint: string, serviceName: string = 'public') {
    // Validate and normalize API endpoint (remove trailing slash)
    if (apiEndpoint === '') {
      throw new Error('PDP API endpoint is required')
    }
    this.apiEndpoint = apiEndpoint.endsWith('/') ? apiEndpoint.slice(0, -1) : apiEndpoint

    // Store service name
    this.serviceName = serviceName
  }

  /**
   * Upload data to the PDP server
   * @param data - The raw data to upload
   * @param commp - The CommP (piece commitment) of the data
   * @returns Promise that resolves when upload is complete
   */
  async upload (data: Uint8Array | ArrayBuffer, commp: CommP): Promise<void> {
    // Convert ArrayBuffer to Uint8Array if needed
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const byteLength = bytes.length

    // Step 1: POST to create the upload
    const uploadId = await this._createUpload(commp, byteLength)

    // Step 2: PUT the actual data
    await this._uploadData(uploadId, bytes)
  }

  /**
   * Create an upload by posting CommP and size
   * @returns The upload ID extracted from the Location header
   */
  private async _createUpload (commp: CommP, byteLength: number): Promise<string> {
    // Extract the raw hash from the CommP CID
    // The multihash contains the hash algorithm code followed by the hash length and then the hash
    const hashBytes = commp.multihash.digest
    const hashHex = toHex(hashBytes)

    const checkData = {
      name: MULTIHASH_CODES.SHA2_256_TRUNC254_PADDED,
      hash: hashHex,
      size: byteLength
    }

    const requestBody = {
      check: checkData
      // No notify URL needed as per requirements
    }

    const response = await fetch(`${this.apiEndpoint}/pdp/piece`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // No Authorization header needed (null authentication)
      },
      body: JSON.stringify(requestBody)
    })

    if (response.status === 200) {
      // Piece already exists on server
      const data = await response.json() as { pieceCID: string }
      console.log(`Piece already exists on server: ${data.pieceCID}`)
      return '' // No upload needed
    }

    if (response.status !== 201) {
      const errorText = await response.text()
      throw new Error(`Failed to create upload: ${response.status} ${response.statusText} - ${errorText}`)
    }

    // Extract upload ID from Location header
    const location = response.headers.get('Location')
    if (location == null) {
      throw new Error('Server did not provide Location header in response (may be restricted by CORS policy)')
    }

    // Validate the location format and extract UUID
    // Match /pdp/piece/upload/UUID or /piece/upload/UUID anywhere in the path
    const locationMatch = location.match(/\/(?:pdp\/)?piece\/upload\/([a-fA-F0-9-]+)/)
    if (locationMatch == null) {
      throw new Error(`Invalid Location header format: ${location}`)
    }

    return locationMatch[1] // Return just the UUID
  }

  /**
   * Upload the actual data bytes
   */
  private async _uploadData (uploadId: string, data: Uint8Array): Promise<void> {
    // If uploadId is empty, the piece already exists
    if (uploadId === '') {
      return
    }

    const uploadUrl = `${this.apiEndpoint}/pdp/piece/upload/${uploadId}`

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length.toString()
        // No Authorization header needed (null authentication)
      },
      body: data
    })

    if (response.status !== 204) {
      const errorText = await response.text()
      throw new Error(`Failed to upload data: ${response.status} ${response.statusText} - ${errorText}`)
    }
  }

  /**
   * Get the service name
   */
  getServiceName (): string {
    return this.serviceName
  }

  /**
   * Get the API endpoint
   */
  getApiEndpoint (): string {
    return this.apiEndpoint
  }
}
