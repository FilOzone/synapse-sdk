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
    },
    async sendTransaction (transaction: any) {
      if (provider != null) {
        return provider.sendTransaction(transaction)
      }
      throw new Error('No provider for sendTransaction')
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
    getBlock: async (blockHashOrBlockTag: any) => {
      return {
        number: 1000000,
        timestamp: Math.floor(Date.now() / 1000),
        hash: '0x' + Math.random().toString(16).substring(2).padEnd(64, '0')
      }
    },
    call: async (transaction: any) => {
      const data = transaction.data
      const to = transaction.to?.toLowerCase()
      if (data == null) return '0x'

      // Mock getServicePrice response for WarmStorage contract - function selector: 0x7bca0328
      // Check both the function selector and that it's to the WarmStorage contract address
      if (data?.startsWith('0x7bca0328') === true &&
          (to === '0x394feca6bcb84502d93c0c5c03c620ba8897e8f4' || // calibration address
           to === '0xbfdc4454c2b573079c6c5ea1ddef6b8defc03dd5')) { // might be used in some tests
        // Return mock pricing data: 2 USDFC per TiB per month, USDFC address, 86400 epochs per month
        const pricePerTiBPerMonth = ethers.parseUnits('2', 18) // 2 USDFC with 18 decimals
        const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0' // Mock USDFC address
        const epochsPerMonth = 86400n
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'address', 'uint256'],
          [pricePerTiBPerMonth, tokenAddress, epochsPerMonth]
        )
      }
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
      // Mock accounts response with 4 fields (fixed bug)
      if (data.includes('ad74b775') === true) {
        const funds = ethers.parseUnits('500', 18)
        const lockupCurrent = 0n
        const lockupRate = 0n
        const lockupLastSettledAt = 1000000 // Current epoch (block number)
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256', 'uint256', 'uint256'],
          [funds, lockupCurrent, lockupRate, lockupLastSettledAt]
        )
      }
      // Mock getServicePrice response - function selector: 0x5482bdf9
      if (data.includes('5482bdf9') === true) {
        const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18) // 2 USDFC per TiB per month
        const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18) // 3 USDFC per TiB per month with CDN
        const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0' // USDFC on calibration
        const epochsPerMonth = 86400n
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['tuple(uint256,uint256,address,uint256)'],
          [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
        )
      }
      // Mock getRailsByPayer response - function selector: 0x89c6a46f
      if (data.includes('89c6a46f') === true) {
        // Return array of rail IDs
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256[]'],
          [[1n, 2n]]
        )
      }
      // Mock getRailsByPayee response - function selector: 0x7a8fa2f1
      if (data.includes('7a8fa2f1') === true) {
        // Return array of rail IDs
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256[]'],
          [[3n, 4n]]
        )
      }
      // Mock getRail response - function selector: 0x0e64d1e0
      if (data.includes('0e64d1e0') === true) {
        const rail = {
          token: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
          from: '0x1234567890123456789012345678901234567890',
          to: '0x78bF4d833fC2ba1Abd42Bc772edbC788EC76A28F',
          operator: '0xBfDC4454c2B573079C6c5eA1DDeF6B8defC03dd5',
          arbiter: '0xBfDC4454c2B573079C6c5eA1DDeF6B8defC03dd5',
          paymentRate: ethers.parseUnits('0.001', 18), // 0.001 USDFC per epoch
          paymentRateNew: ethers.parseUnits('0.001', 18),
          rateChangeEpoch: 0n,
          lockupFixed: 0n,
          lockupPeriod: 28800n, // 10 days
          settledUpTo: 1000000,
          endEpoch: 0n, // Active rail
          commissionRateBps: 100n // 1%
        }
        // The getRail function returns a struct, encode all fields in order
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'address', 'address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
          [rail.token, rail.from, rail.to, rail.operator, rail.arbiter, rail.paymentRate, rail.paymentRateNew, rail.rateChangeEpoch, rail.lockupFixed, rail.lockupPeriod, rail.settledUpTo, rail.endEpoch, rail.commissionRateBps]
        )
      }
      // Mock operatorApprovals response
      if (data.includes('e3d4c69e') === true) {
        const isApproved = false
        const rateAllowance = 0n
        const rateUsed = 0n
        const lockupAllowance = 0n
        const lockupUsed = 0n
        const maxLockupPeriod = 86400n // 30 days
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['bool', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
          [isApproved, rateAllowance, rateUsed, lockupAllowance, lockupUsed, maxLockupPeriod]
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
    getTransaction: async (hash: string) => {
      throw new Error('Not implemented in mock')
    },
    getTransactionReceipt: async (hash: string) => {
      return {
        hash,
        from: '0x1234567890123456789012345678901234567890',
        to: null,
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
      }
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
