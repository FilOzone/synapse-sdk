/**
 * Shared test utilities and mock helpers
 */

import { ethers } from 'ethers'

// Mock signer factory
export function createMockSigner (address: string = '0x1234567890123456789012345678901234567890', provider?: any): ethers.Signer {
  const signer = {
    provider: provider ?? null,
    async getAddress () { return address },
    async signTransaction () { return '0xsignedtransaction' },
    async signMessage () { return '0xsignedmessage' },
    async signTypedData () { return '0xsignedtypeddata' },
    connect (newProvider: any) {
      return createMockSigner(address, newProvider)
    }
  }
  return signer as unknown as ethers.Signer
}

// Mock provider factory
export function createMockProvider (chainId: number = 314159): ethers.Provider {
  const network = new ethers.Network('test', chainId)

  const provider: any = {
    getNetwork: async () => network,
    getSigner: async function () {
      return createMockSigner('0x1234567890123456789012345678901234567890', this)
    },
    getBalance: async (address: string) => ethers.parseEther('100'),
    getTransactionCount: async (address: string, blockTag?: string) => 0,
    call: async (transaction: any) => {
      const data = transaction.data
      if (data == null) return '0x'
      if (data.includes('70a08231') === true) {
        return ethers.zeroPadValue(ethers.toBeHex(ethers.parseUnits('1000', 18)), 32)
      }
      if (data.includes('313ce567') === true) {
        return ethers.zeroPadValue(ethers.toBeHex(18), 32)
      }
      if (data.includes('dd62ed3e') === true) {
        return ethers.zeroPadValue(ethers.toBeHex(0), 32)
      }
      if (data.includes('095ea7b3') === true) {
        return ethers.zeroPadValue(ethers.toBeHex(1), 32)
      }
      if (data.includes('ad74b775') === true) {
        const funds = ethers.parseUnits('500', 18)
        const lockedFunds = 0n
        const frozen = false
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256', 'bool'],
          [funds, lockedFunds, frozen]
        )
      }
      return '0x'
    },
    getBlockNumber: async () => 1000000,
    getCode: async (address: string) => '0x1234',
    estimateGas: async (transaction: any) => 21000n,
    getFeeData: async () => new ethers.FeeData(
      ethers.parseUnits('1', 'gwei'),
      ethers.parseUnits('1', 'gwei'),
      ethers.parseUnits('1', 'gwei')
    ),
    getLogs: async (filter: any) => [],
    resolveName: async (name: string) => null,
    lookupAddress: async (address: string) => null,
    broadcastTransaction: async (signedTx: string) => {
      throw new Error('Not implemented in mock')
    },
    getBlock: async (blockHashOrBlockTag: any) => {
      throw new Error('Not implemented in mock')
    },
    getTransaction: async (hash: string) => {
      throw new Error('Not implemented in mock')
    },
    getTransactionReceipt: async (hash: string) => {
      throw new Error('Not implemented in mock')
    },
    waitForTransaction: async (hash: string, confirmations?: number, timeout?: number) => {
      throw new Error('Not implemented in mock')
    },
    sendTransaction: async (transaction: any) => {
      const hash = '0x' + Math.random().toString(16).substring(2).padEnd(64, '0')
      return {
        hash,
        from: transaction.from ?? '',
        to: transaction.to ?? null,
        data: transaction.data ?? '',
        value: transaction.value ?? 0n,
        chainId: 314159n,
        gasLimit: 100000n,
        gasPrice: 1000000000n,
        nonce: 0,
        wait: async () => ({
          hash,
          from: transaction.from ?? '',
          to: transaction.to ?? null,
          contractAddress: null,
          index: 0,
          root: '',
          gasUsed: 50000n,
          gasPrice: 1000000000n,
          cumulativeGasUsed: 50000n,
          effectiveGasPrice: 1000000000n,
          logsBloom: '',
          blockHash: '',
          blockNumber: 1000000,
          logs: [],
          status: 1
        })
      } as any
    }
  }

  return provider as ethers.Provider
}
