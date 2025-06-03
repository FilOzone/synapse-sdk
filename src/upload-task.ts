/**
 * Mock implementation of UploadTask
 *
 * None of this works, it's all fake, and is all subject to change as we
 * implement the real UploadTask.
 */

import { CID } from 'multiformats/cid'
import type { UploadTask, CommP, StorageProvider } from './types.js'

export class MockUploadTask implements UploadTask {
  private readonly _data: Uint8Array
  private _commp?: CommP
  private _sp?: StorageProvider
  private _txHash?: string
  private readonly _withCDN: boolean

  constructor (data: Uint8Array | ArrayBuffer, withCDN: boolean) {
    this._data = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    this._withCDN = withCDN
    console.log('[MockSynapse] UploadTask created with', this._data.length, 'bytes (withCDN=', this._withCDN, ')')
  }

  async commp (): Promise<CommP> {
    console.log('[MockSynapse] UploadTask.commp() called')
    if (this._commp == null) {
      // Mock CommP generation - in reality this would be more complex
      console.log('[MockSynapse] Generating mock CommP for', this._data.length, 'bytes...')
      console.log('[MockSynapse] Simulating CommP calculation delay...')
      await new Promise(resolve => setTimeout(resolve, 100))

      // Use a hardcoded mock CommP for testing
      const mockCommPString = 'baga6ea4seaqjtovkwk4myyzj56eztkh5pzsk5upksan6f5outesy62bsvl4dsha'

      // Parse as CommP
      this._commp = CID.parse(mockCommPString) as CommP
      console.log('[MockSynapse] CommP generated:', this._commp.toString())
    } else {
      console.log('[MockSynapse] Returning cached CommP:', this._commp.toString())
    }
    return this._commp
  }

  async store (): Promise<StorageProvider> {
    console.log('[MockSynapse] UploadTask.store() called')
    if (this._sp == null) {
      // Ensure commp is generated first
      console.log('[MockSynapse] Ensuring CommP is generated before storage...')
      await this.commp()

      console.log('[MockSynapse] Negotiating with storage provider...')
      // Mock storage provider
      this._sp = 'f01234' // Mock SP address
      console.log('[MockSynapse] Selected storage provider:', this._sp)

      // Simulate network delay
      console.log('[MockSynapse] Simulating storage negotiation delay (500ms)...')
      await new Promise(resolve => setTimeout(resolve, 500))
      console.log('[MockSynapse] Storage negotiation complete')
    } else {
      console.log('[MockSynapse] Returning cached storage provider:', this._sp)
    }
    return this._sp
  }

  async done (): Promise<string> {
    console.log('[MockSynapse] UploadTask.done() called')
    if (this._txHash == null) {
      // Ensure previous steps are complete
      console.log('[MockSynapse] Ensuring storage is complete before chain commit...')
      await this.store()

      console.log('[MockSynapse] Submitting transaction to blockchain...')
      // Mock transaction hash - generate 64 hex characters
      this._txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      console.log('[MockSynapse] Generated mock transaction hash:', this._txHash)

      // Simulate network delay
      console.log('[MockSynapse] Simulating blockchain confirmation delay (1000ms)...')
      await new Promise(resolve => setTimeout(resolve, 1000))
      console.log('[MockSynapse] Transaction confirmed on chain')
    } else {
      console.log('[MockSynapse] Returning cached transaction hash:', this._txHash)
    }
    return this._txHash
  }
}
