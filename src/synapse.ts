/**
 * Mock implementation of the main Synapse class
 */

import type { Synapse as ISynapse, SynapseOptions, StorageOptions, TokenAmount } from './types.js'
import { MockStorageService } from './storage-service.js'

export class MockSynapse implements ISynapse {
  private _options: SynapseOptions
  private _balance: number = 100 // Mock starting balance

  constructor(options: SynapseOptions) {
    this._options = options
    console.log('[Mock] Synapse initialized with options:', {
      withCDN: options.withCDN,
      rpcAPI: options.rpcAPI,
      serviceContract: options.serviceContract,
    })
  }

  async balance(): Promise<TokenAmount> {
    console.log('[Mock] Checking balance...')

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 200))

    return this._balance
  }

  async deposit(amount: TokenAmount): Promise<TokenAmount> {
    const depositAmount = typeof amount === 'string' ? parseFloat(amount) : Number(amount)
    console.log(`[Mock] Depositing ${depositAmount} USDFC...`)

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000))

    this._balance += depositAmount
    console.log(`[Mock] Deposit successful, new balance: ${this._balance}`)

    return this._balance
  }

  async withdraw(amount: TokenAmount): Promise<TokenAmount> {
    const withdrawAmount = typeof amount === 'string' ? parseFloat(amount) : Number(amount)
    console.log(`[Mock] Withdrawing ${withdrawAmount} USDFC...`)

    if (withdrawAmount > this._balance) {
      throw new Error('Insufficient balance')
    }

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000))

    this._balance -= withdrawAmount
    console.log(`[Mock] Withdrawal successful, new balance: ${this._balance}`)

    return this._balance
  }

  async createStorage(options?: StorageOptions): Promise<MockStorageService> {
    console.log('[Mock] Creating storage service...')

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500))

    // Generate mock proof set ID if not provided
    const proofSetId = options?.proofSetId || 'ps_' + Math.random().toString(36).substring(2, 15)

    // Use provided SP or default mock
    const storageProvider = options?.storageProvider || 'f01234'

    console.log(`[Mock] Storage service created with proofSetId: ${proofSetId}, SP: ${storageProvider}`)

    return new MockStorageService(proofSetId, storageProvider)
  }
}

// Export the mock as the default Synapse implementation
export const Synapse = MockSynapse