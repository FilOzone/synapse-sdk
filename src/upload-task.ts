/**
 * Mock implementation of UploadTask
 */

import { CID } from 'multiformats/cid'
import type { UploadTask, CommP, StorageProvider } from './types.js'

export class MockUploadTask implements UploadTask {
  private _data: Uint8Array
  private _commp?: CommP
  private _sp?: StorageProvider
  private _txHash?: string

  constructor(data: Uint8Array | ArrayBuffer) {
    this._data = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  }

  async commp(): Promise<CommP> {
    if (!this._commp) {
      // Mock CommP generation - in reality this would be more complex
      console.log('[Mock] Generating CommP for', this._data.length, 'bytes...')

      // Use a hardcoded mock CommP for testing
      const mockCommPString = 'baga6ea4seaqjtovkwk4myyzj56eztkh5pzsk5upksan6f5outesy62bsvl4dsha'

      // Parse as CommP
      this._commp = CID.parse(mockCommPString) as CommP
    }
    return this._commp
  }

  async store(): Promise<StorageProvider> {
    if (!this._sp) {
      // Ensure commp is generated first
      await this.commp()

      console.log('[Mock] Storing data with provider...')
      // Mock storage provider
      this._sp = 'f01234' // Mock SP address

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    return this._sp
  }

  async done(): Promise<string> {
    if (!this._txHash) {
      // Ensure previous steps are complete
      await this.store()

      console.log('[Mock] Committing to chain...')
      // Mock transaction hash
      this._txHash = '0x' + Math.random().toString(16).substring(2, 66)

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    return this._txHash
  }
}