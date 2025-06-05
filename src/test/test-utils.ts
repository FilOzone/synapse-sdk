/**
 * Shared test utilities and mocks
 */

import { ethers } from 'ethers'

// Create a mock signer using object literal with type assertion
export function createMockSigner (address: string = '0x1234567890123456789012345678901234567890', provider?: ethers.Provider): ethers.Signer {
  return {
    provider: provider ?? null,
    async getAddress () { return address },
    async signTransaction () { return '0xsignedtransaction' },
    async signMessage () { return '0xsignedmessage' },
    async signTypedData () { return '0xsignedtypeddata' },
    connect (newProvider: ethers.Provider) { return createMockSigner(address, newProvider) }
  } as unknown as ethers.Signer
}

// Mock provider that simulates basic blockchain interactions
export class MockProvider extends ethers.AbstractProvider {
  private readonly _network: ethers.Network
  private readonly _mockSigner: ethers.Signer

  constructor (chainId: number = 314159) {
    super()
    this._network = new ethers.Network('test', chainId)
    this._mockSigner = createMockSigner('0x1234567890123456789012345678901234567890', this as any)
  }

  async getNetwork (): Promise<ethers.Network> {
    return this._network
  }

  async getSigner (): Promise<ethers.Signer> {
    return this._mockSigner
  }

  async getBalance (address: string): Promise<bigint> {
    // Mock FIL balance: 100 FIL
    return ethers.parseEther('100')
  }

  async getTransactionCount (address: string, blockTag?: string): Promise<number> {
    return 0
  }

  async call (transaction: ethers.TransactionRequest): Promise<string> {
    // Mock contract calls
    if (transaction.data?.includes('70a08231') === true) {
      // balanceOf call - return 1000 USDFC (18 decimals)
      return ethers.zeroPadValue(ethers.toBeHex(ethers.parseUnits('1000', 18)), 32)
    }
    if (transaction.data?.includes('313ce567') === true) {
      // decimals call - return 18
      return ethers.zeroPadValue(ethers.toBeHex(18), 32)
    }
    if (transaction.data?.includes('dd62ed3e') === true) {
      // allowance call - return 0
      return ethers.zeroPadValue(ethers.toBeHex(0), 32)
    }
    if (transaction.data?.includes('095ea7b3') === true) {
      // approve call - return true
      return ethers.zeroPadValue(ethers.toBeHex(1), 32)
    }
    if (transaction.data?.includes('ad74b775') === true) {
      // accounts(address,address) call - return (funds: 500 USDFC, lockedFunds: 0, frozen: false)
      const funds = ethers.parseUnits('500', 18)
      const lockedFunds = 0n
      const frozen = false
      return ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'bool'],
        [funds, lockedFunds, frozen]
      )
    }
    return '0x'
  }

  async broadcastTransaction (signedTx: string): Promise<ethers.TransactionResponse> {
    throw new Error('Not implemented in mock')
  }

  async getBlock (blockHashOrBlockTag: string | number): Promise<ethers.Block | null> {
    throw new Error('Not implemented in mock')
  }

  async getTransaction (hash: string): Promise<ethers.TransactionResponse | null> {
    throw new Error('Not implemented in mock')
  }

  async getTransactionReceipt (hash: string): Promise<ethers.TransactionReceipt | null> {
    throw new Error('Not implemented in mock')
  }

  async getLogs (filter: ethers.Filter): Promise<ethers.Log[]> {
    return []
  }

  async resolveName (name: string): Promise<string | null> {
    return null
  }

  async lookupAddress (address: string): Promise<string | null> {
    return null
  }

  async waitForTransaction (hash: string, confirmations?: number, timeout?: number): Promise<ethers.TransactionReceipt | null> {
    throw new Error('Not implemented in mock')
  }

  async estimateGas (transaction: ethers.TransactionRequest): Promise<bigint> {
    return 21000n
  }

  async getFeeData (): Promise<ethers.FeeData> {
    return new ethers.FeeData(ethers.parseUnits('1', 'gwei'), ethers.parseUnits('1', 'gwei'), ethers.parseUnits('1', 'gwei'))
  }

  async _perform (req: ethers.PerformActionRequest): Promise<any> {
    throw new Error('Not implemented in mock')
  }
}
