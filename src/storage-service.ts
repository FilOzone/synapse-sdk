/**
 * Mock implementation of StorageService
 */

import type { StorageService, CommP, DownloadOptions, SettlementResult, ProofSetId, StorageProvider } from './types.js'
import { MockUploadTask } from './upload-task.js'
import { normalizeCommP } from './commp.js'

export class MockStorageService implements StorageService {
  readonly proofSetId: ProofSetId
  readonly storageProvider: StorageProvider
  private _storedData: Map<string, Uint8Array> = new Map()

  constructor(proofSetId: ProofSetId, storageProvider: StorageProvider) {
    this.proofSetId = proofSetId
    this.storageProvider = storageProvider
  }

  upload(data: Uint8Array | ArrayBuffer): MockUploadTask {
    console.log('[Mock] Starting upload...')
    const uploadTask = new MockUploadTask(data)

    // Store data for later retrieval (in mock)
    const storeData = async () => {
      const commp = await uploadTask.commp()
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
      this._storedData.set(commp.toString(), bytes)
    }
    storeData().catch(console.error)

    return uploadTask
  }

  async download(commp: CommP | string, options?: DownloadOptions): Promise<Uint8Array> {
    const normalizedCommP = normalizeCommP(commp)
    const commpString = normalizedCommP.toString()

    console.log('[Mock] Downloading', commpString)
    console.log('[Mock] Options:', options)

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300))

    // Check if we have the data stored
    const data = this._storedData.get(commpString)
    if (!data) {
      throw new Error(`Data not found for CommP: ${commpString}`)
    }

    // Mock verification
    if (!options?.noVerify) {
      console.log('[Mock] Verifying data integrity...')
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    // Return a copy of the data
    return new Uint8Array(data)
  }

  async delete(commp: CommP | string): Promise<void> {
    const normalizedCommP = normalizeCommP(commp)
    const commpString = normalizedCommP.toString()

    console.log('[Mock] Deleting', commpString)

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500))

    // Remove from mock storage
    this._storedData.delete(commpString)
  }

  async settlePayments(): Promise<SettlementResult> {
    console.log('[Mock] Settling payments...')

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000))

    return {
      settledAmount: '0.05', // Mock amount in USDFC
      epoch: Math.floor(Date.now() / 30000), // Mock epoch
    }
  }
}