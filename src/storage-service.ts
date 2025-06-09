/**
 * Mock implementation of StorageService
 *
 * None of this works, it's all fake, and is all subject to change as we
 * implement the real StorageService!
 */

import type { CommP, DownloadOptions, ProofSetId, StorageProvider } from './types.js'
import { MockUploadTask } from './upload-task.js'
import { asCommP } from './commp/index.js'

export class MockStorageService {
  readonly proofSetId: ProofSetId
  readonly storageProvider: StorageProvider
  private readonly _storedData: Map<string, Uint8Array> = new Map()
  private readonly _signerAddress: string
  private readonly _withCDN: boolean

  constructor (proofSetId: ProofSetId, storageProvider: StorageProvider, signerAddress: string, withCDN: boolean) {
    this.proofSetId = proofSetId
    this.storageProvider = storageProvider
    this._signerAddress = signerAddress
    this._withCDN = withCDN
  }

  upload (data: Uint8Array | ArrayBuffer): MockUploadTask {
    console.log('[MockSynapse] StorageService.upload() called')
    console.log('[MockSynapse] Data size:', data instanceof ArrayBuffer ? data.byteLength : data.length, 'bytes')
    const uploadTask = new MockUploadTask(data, this._withCDN)

    // Store data for later retrieval (in mock)
    const storeData = async (): Promise<void> => {
      console.log('[MockSynapse] Storing data internally for mock retrieval...')
      const commp = await uploadTask.commp()
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
      this._storedData.set(commp.toString(), bytes)
      console.log('[MockSynapse] Data stored with CommP:', commp.toString())
    }
    storeData().catch(() => {})

    return uploadTask
  }

  async download (commp: CommP | string, options?: DownloadOptions): Promise<Uint8Array> {
    const normalizedCommP = asCommP(commp)
    if (normalizedCommP == null) {
      throw new Error('Invalid CommP provided')
    }
    const commpString = normalizedCommP.toString()
    console.log('[MockSynapse] StorageService.download() called')
    console.log('[MockSynapse] CommP:', commpString)
    console.log('[MockSynapse] Download options:', options)

    if (options?.withCDN !== false && (this._withCDN || options?.withCDN)) {
      console.log('[MockSynapse] Using CDN for download (withCDN=true)')
      const res = await fetch(`https://${this._signerAddress}.calibration.filcdn.io/${commpString}`)
      return new Uint8Array(await res.arrayBuffer())
    }

    // Simulate network delay
    console.log('[MockSynapse] Simulating download network delay (300ms)...')
    await new Promise(resolve => setTimeout(resolve, 300))

    // Check if we have the data stored
    console.log('[MockSynapse] Looking up data in mock storage...')
    const data = this._storedData.get(commpString)
    if (data == null) {
      console.log('[MockSynapse] Data not found in mock storage!')
      throw new Error(`Data not found for CommP: ${commpString}`)
    }
    console.log('[MockSynapse] Data found, size:', data.length, 'bytes')

    // Mock verification
    if (options?.noVerify !== true) {
      console.log('[MockSynapse] Verifying data integrity...')
      console.log('[MockSynapse] Simulating verification delay (200ms)...')
      await new Promise(resolve => setTimeout(resolve, 200))
      console.log('[MockSynapse] Data verification complete')
    } else {
      console.log('[MockSynapse] Skipping verification (noVerify=true)')
    }

    // Return a copy of the data
    console.log('[MockSynapse] Returning data copy')
    return new Uint8Array(data)
  }
}
