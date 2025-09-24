/**
 * Shared test utilities and mock helpers
 *
 * Example usage:
 *   const cleanup = extendMockProviderCall(mockProvider, async (transaction) => {
 *     // Only custom test logic - Multicall3 etc handled automatically
 *     if (someCondition) return customResult
 *     return null // Let default mocks handle it
 *   })
 *   try {
 *     // ... test code ...
 *   } finally {
 *     cleanup()
 *   }
 */

import { ethers } from 'ethers'
import type { SPRegistryService } from '../sp-registry/index.ts'
import type { ProviderInfo } from '../sp-registry/types.ts'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES, SIZE_CONSTANTS, TIME_CONSTANTS } from '../utils/constants.ts'
import { ProviderResolver } from '../utils/provider-resolver.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'

/**
 * Addresses used by testing
 */
export const MOCK_ADDRESSES = {
  PAYMENTS: '0x80Df863d84eFaa0aaC8da2E9B08D14A7236ff4D0' as const,
  PDP_VERIFIER: '0x3ce3C62C4D405d69738530A6A65E4b13E8700C48' as const,
  SIGNER: '0x1234567890123456789012345678901234567890' as const,
  WARM_STORAGE: '0xEB022abbaa66D9F459F3EC2FeCF81a6D03c2Cb6F' as const,
  WARM_STORAGE_VIEW: '0x1996B60838871D0bc7980Bc02DD6Eb920535bE54' as const,
}

// Mock signer factory
export function createMockSigner(address: string = MOCK_ADDRESSES.SIGNER, provider?: any): ethers.Signer {
  const signer = {
    provider: provider ?? null,
    async getAddress() {
      return address
    },
    async signTransaction() {
      return '0xsignedtransaction'
    },
    async signMessage() {
      return '0xsignedmessage'
    },
    async signTypedData() {
      return '0xsignedtypeddata'
    },
    connect(newProvider: any) {
      return createMockSigner(address, newProvider)
    },
    async sendTransaction(transaction: any) {
      if (provider != null) {
        return provider.sendTransaction(transaction)
      }
      throw new Error('No provider for sendTransaction')
    },
  }
  return signer as unknown as ethers.Signer
}

// Mock provider factory
export function createMockProvider(chainId: number = 314159): ethers.Provider {
  const network = new ethers.Network('calibration', chainId)

  const provider: any = {
    getNetwork: async () => network,
    getSigner: async function () {
      return createMockSigner(MOCK_ADDRESSES.SIGNER, this)
    },
    getBalance: async (_address: string) => ethers.parseEther('100'),
    getTransactionCount: async (_address: string, _blockTag?: string) => 0,
    getBlock: async (_blockHashOrBlockTag: any) => {
      return {
        number: 1000000,
        timestamp: Math.floor(Date.now() / 1000),
        hash: `0x${Math.random().toString(16).substring(2).padEnd(64, '0')}`,
      }
    },
    call: async (transaction: any) => {
      const data = transaction.data
      const to = transaction.to?.toLowerCase()
      if (data == null) return '0x'

      // Mock Multicall3 aggregate3 calls - function selector: 0x82ad56cb
      if (to === CONTRACT_ADDRESSES.MULTICALL3.calibration.toLowerCase() && data?.startsWith('0x82ad56cb')) {
        // Return mock addresses for all 5 getter functions
        const mockAddresses = [
          MOCK_ADDRESSES.PDP_VERIFIER, // pdpVerifier
          MOCK_ADDRESSES.PAYMENTS, // payments
          CONTRACT_ADDRESSES.USDFC.calibration, // usdfcToken
          '0x0000000000000000000000000000000000000000', // filCDN (not used)
          MOCK_ADDRESSES.WARM_STORAGE_VIEW, // viewContract
          '0x0000000000000000000000000000000000000001', // spRegistry
        ]

        // Encode the response as Multicall3 would
        const results = mockAddresses.map((addr) => ({
          success: true,
          returnData: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [addr]),
        }))

        return ethers.AbiCoder.defaultAbiCoder().encode(['tuple(bool success, bytes returnData)[]'], [results])
      }

      // Mock viewContractAddress response - function selector: 0x7a9ebc15
      if (data?.startsWith('0x7a9ebc15') === true) {
        // Return a mock view contract address (not zero address!)
        const viewAddress = MOCK_ADDRESSES.WARM_STORAGE_VIEW // Use a real-looking address
        return ethers.AbiCoder.defaultAbiCoder().encode(['address'], [viewAddress])
      }

      // Mock getServicePrice response for WarmStorage contract - function selector: 0x7bca0328
      // Check both the function selector and that it's to the WarmStorage contract address
      if (
        data?.startsWith('0x7bca0328') === true &&
        (to === '0x394feca6bcb84502d93c0c5c03c620ba8897e8f4' || // calibration address
          to === '0xbfdc4454c2b573079c6c5ea1ddef6b8defc03dd5')
      ) {
        // might be used in some tests
        // Return mock pricing data: 2 USDFC per TiB per month, USDFC address, 86400 epochs per month
        const pricePerTiBPerMonth = ethers.parseUnits('2', 18) // 2 USDFC with 18 decimals
        const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration // Mock USDFC address
        const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
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
        const paymentsInterface = new ethers.Interface(CONTRACT_ABIS.PAYMENTS)
        return paymentsInterface.encodeFunctionResult('accounts', [
          ethers.parseUnits('500', 18), // funds
          0n, // lockupCurrent
          0n, // lockupRate
          1000000n, // lockupLastSettledAt (current epoch/block number)
        ])
      }
      // Mock getServicePrice response - function selector: 0x5482bdf9
      if (data.includes('5482bdf9') === true) {
        const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18) // 2 USDFC per TiB per month
        const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18) // 3 USDFC per TiB per month with CDN
        const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration // USDFC on calibration
        const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['tuple(uint256,uint256,address,uint256)'],
          [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
        )
      }
      // Mock getRailsByPayer response - function selector: 0x89c6a46f
      if (data.includes('89c6a46f') === true) {
        // Return array of rail IDs
        return ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[1n, 2n]])
      }
      // Mock getRailsByPayee response - function selector: 0x7a8fa2f1
      if (data.includes('7a8fa2f1') === true) {
        // Return array of rail IDs
        return ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[3n, 4n]])
      }
      // Mock NETWORK_FEE response - function selector: 0x9be5c024
      // Check if it's to the Payments contract
      if (to === MOCK_ADDRESSES.PAYMENTS.toLowerCase() && data?.includes('9be5c024') === true) {
        // Return 0.0013 FIL as the network fee (1300000000000000 attoFIL)
        return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ethers.parseEther('0.0013')])
      }
      // Mock getRail response - function selector: 0x22e440b3
      if (data.includes('22e440b3') === true) {
        // Use the Payments ABI to properly encode the RailView struct
        const paymentsInterface = new ethers.Interface(CONTRACT_ABIS.PAYMENTS)
        const railData = {
          token: CONTRACT_ADDRESSES.USDFC.calibration,
          from: MOCK_ADDRESSES.SIGNER,
          to: '0xaabbccddaabbccddaabbccddaabbccddaabbccdd',
          operator: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
          validator: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
          paymentRate: ethers.parseUnits('1', 18),
          lockupPeriod: 2880n,
          lockupFixed: 0n,
          settledUpTo: 1000000n,
          endEpoch: 0n, // 0 = active rail
          commissionRateBps: 500n, // 5%
          serviceFeeRecipient: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4',
        }
        return paymentsInterface.encodeFunctionResult('getRail', [railData])
      }
      // Mock operatorApprovals response
      if (data.includes('e3d4c69e') === true) {
        const paymentsInterface = new ethers.Interface(CONTRACT_ABIS.PAYMENTS)
        return paymentsInterface.encodeFunctionResult('operatorApprovals', [
          false, // isApproved
          0n, // rateAllowance
          0n, // lockupAllowance
          0n, // rateUsed
          0n, // lockupUsed
          TIME_CONSTANTS.EPOCHS_PER_MONTH, // maxLockupPeriod (30 days)
        ])
      }
      // Mock getRailsForPayerAndToken response - function selector: 0x9b85e253
      if (data.includes('9b85e253') === true) {
        const paymentsInterface = new ethers.Interface(CONTRACT_ABIS.PAYMENTS)
        const rails = [
          { railId: 1n, isTerminated: false, endEpoch: 0n },
          { railId: 2n, isTerminated: true, endEpoch: 999999n },
        ]
        return paymentsInterface.encodeFunctionResult('getRailsForPayerAndToken', [rails])
      }
      // Mock getRailsForPayeeAndToken response - function selector: 0x2ecfb2bf
      if (data.includes('2ecfb2bf') === true) {
        const paymentsInterface = new ethers.Interface(CONTRACT_ABIS.PAYMENTS)
        const rails = [{ railId: 3n, isTerminated: false, endEpoch: 0n }]
        return paymentsInterface.encodeFunctionResult('getRailsForPayeeAndToken', [rails])
      }
      // Mock settleRail response - function selector: 0xbcd40bf8
      if (data.includes('bcd40bf8') === true) {
        const paymentsInterface = new ethers.Interface(CONTRACT_ABIS.PAYMENTS)
        return paymentsInterface.encodeFunctionResult('settleRail', [
          ethers.parseUnits('100', 18), // totalSettledAmount
          ethers.parseUnits('95', 18), // totalNetPayeeAmount
          ethers.parseUnits('5', 18), // totalOperatorCommission
          1000000n, // finalSettledEpoch
          'Settlement successful', // note
        ])
      }
      // Mock settleTerminatedRailWithoutValidation response - function selector: 0x4341325c
      if (data.includes('4341325c') === true) {
        const paymentsInterface = new ethers.Interface(CONTRACT_ABIS.PAYMENTS)
        return paymentsInterface.encodeFunctionResult('settleTerminatedRailWithoutValidation', [
          ethers.parseUnits('200', 18), // totalSettledAmount
          ethers.parseUnits('190', 18), // totalNetPayeeAmount
          ethers.parseUnits('10', 18), // totalOperatorCommission
          999999n, // finalSettledEpoch
          'Terminated rail settlement', // note
        ])
      }
      return '0x'
    },
    getBlockNumber: async () => 1000000,
    getCode: async (_address: string) => '0x1234',
    estimateGas: async (_transaction: any) => 21000n,
    getFeeData: async () =>
      new ethers.FeeData(
        ethers.parseUnits('1', 'gwei'),
        ethers.parseUnits('1', 'gwei'),
        ethers.parseUnits('1', 'gwei')
      ),
    getLogs: async (_filter: any) => [],
    resolveName: async (_name: string) => null,
    lookupAddress: async (_address: string) => null,
    broadcastTransaction: async (_signedTx: string) => {
      throw new Error('Not implemented in mock')
    },
    getTransaction: async (_hash: string) => {
      throw new Error('Not implemented in mock')
    },
    getTransactionReceipt: async (hash: string) => {
      return {
        hash,
        from: MOCK_ADDRESSES.SIGNER,
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
        status: 1,
      }
    },
    waitForTransaction: async (_hash: string, _confirmations?: number, _timeout?: number) => {
      throw new Error('Not implemented in mock')
    },
    sendTransaction: async (transaction: any) => {
      const hash = `0x${Math.random().toString(16).substring(2).padEnd(64, '0')}`
      return {
        hash,
        from: transaction.from ?? '',
        to: transaction.to ?? null,
        data: transaction.data ?? '',
        value: transaction.value != null ? BigInt(transaction.value) : 0n,
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
          status: 1,
        }),
      } as any
    },
  }

  return provider as ethers.Provider
}

/**
 * Extends a mock provider's call method with additional mocking logic
 * while preserving the original Multicall3 and viewContractAddress mocking
 */
export function extendMockProviderCall(
  provider: ethers.Provider,
  customMockFn: (transaction: any) => Promise<string | null>
): () => void {
  const originalCall = provider.call
  provider.call = async (transaction: any) => {
    // First try the custom mock logic
    const customResult = await customMockFn(transaction)
    if (customResult !== null) {
      return customResult
    }

    // Fall back to original call method (which includes Multicall3 and other standard mocks)
    if (originalCall && typeof originalCall === 'function') {
      return originalCall.call(provider, transaction)
    }

    return '0x'
  }

  // Return cleanup function
  return () => {
    provider.call = originalCall
  }
}

/**
 * Helper to handle viewContractAddress calls
 */
export function createViewContractAddressMock(viewAddress: string = MOCK_ADDRESSES.WARM_STORAGE_VIEW) {
  return (data: string | undefined): string | null => {
    if (data?.startsWith('0x7a9ebc15') === true) {
      return ethers.AbiCoder.defaultAbiCoder().encode(['address'], [viewAddress])
    }
    return null
  }
}

/**
 * Helper to create custom Multicall3 mock responses with specific addresses
 */
export function createCustomMulticall3Mock(
  provider: ethers.Provider,
  customAddresses?: Partial<{
    pdpVerifier?: string
    payments?: string
    usdfcToken?: string
    filCDN?: string
    viewContract?: string
    spRegistry?: string
  }>
): () => void {
  return extendMockProviderCall(provider, async (transaction: any) => {
    const data = transaction.data
    const to = transaction.to?.toLowerCase()

    // Handle Multicall3 aggregate3 calls with custom addresses
    if (to === CONTRACT_ADDRESSES.MULTICALL3.calibration.toLowerCase() && data?.startsWith('0x82ad56cb')) {
      // Use custom addresses if provided, otherwise use defaults
      const mockAddresses = [
        customAddresses?.pdpVerifier ?? MOCK_ADDRESSES.PDP_VERIFIER, // pdpVerifier
        customAddresses?.payments ?? MOCK_ADDRESSES.PAYMENTS, // payments
        customAddresses?.usdfcToken ?? CONTRACT_ADDRESSES.USDFC.calibration, // usdfcToken
        customAddresses?.filCDN ?? '0x0000000000000000000000000000000000000000', // filCDN (not used)
        customAddresses?.viewContract ?? MOCK_ADDRESSES.WARM_STORAGE_VIEW, // viewContract
        customAddresses?.spRegistry ?? '0x0000000000000000000000000000000000000001', // spRegistry
      ]

      const results = mockAddresses.map((addr) => ({
        success: true,
        returnData: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [addr]),
      }))

      return ethers.AbiCoder.defaultAbiCoder().encode(['tuple(bool success, bytes returnData)[]'], [results])
    }

    return null
  })
}

/**
 * Creates a mock SPRegistryService with customizable behavior
 */
export function createMockSPRegistryService(providers: ProviderInfo[] = []): SPRegistryService {
  const providerMap = new Map<number, ProviderInfo>()
  const addressMap = new Map<string, ProviderInfo>()

  providers.forEach((p) => {
    providerMap.set(p.id, p)
    addressMap.set(p.serviceProvider.toLowerCase(), p)
  })

  const mock: Partial<SPRegistryService> = {
    getProvider: async (id: number) => providerMap.get(id) ?? null,

    getProviderByAddress: async (address: string) => addressMap.get(address.toLowerCase()) ?? null,

    getProviders: async (ids: number[]) => {
      return ids.map((id) => providerMap.get(id)).filter((p) => p != null) as ProviderInfo[]
    },

    getAllActiveProviders: async () => {
      return Array.from(providerMap.values()).filter((p) => p.active)
    },

    getProviderCount: async () => providerMap.size,
  }

  return mock as SPRegistryService
}

/**
 * Creates a mock ProviderResolver with WarmStorage integration
 */
export function createMockProviderResolver(approvedIds: number[], providers: ProviderInfo[] = []): ProviderResolver {
  const mockWarmStorage: Partial<WarmStorageService> = {
    getApprovedProviderIds: async () => approvedIds,
    isProviderIdApproved: async (id: number) => approvedIds.includes(id),
  }

  const mockSPRegistry = createMockSPRegistryService(providers)

  return new ProviderResolver(mockWarmStorage as WarmStorageService, mockSPRegistry)
}

/**
 * Sets up provider mock responses for SPRegistry and WarmStorage contract calls
 * This extends the provider's call method to return mock data for registry operations
 *
 * TODO: this is garbage, de-garbage it
 */
export function setupProviderRegistryMocks(
  provider: ethers.Provider,
  options: {
    approvedIds?: number[]
    providers?: ProviderInfo[]
    throwOnApproval?: boolean
  } = {}
): () => void {
  const {
    approvedIds = [1, 2],
    providers = [
      createMockProviderInfo({ id: 1 }),
      createMockProviderInfo({
        id: 2,
        serviceProvider: '0x2222222222222222222222222222222222222222',
        products: {
          PDP: {
            type: 'PDP',
            isActive: true,
            capabilities: {},
            data: {
              serviceURL: 'https://pdp2.example.com',
              minPieceSizeInBytes: BigInt(1024),
              maxPieceSizeInBytes: BigInt(32) * BigInt(1024) * BigInt(1024) * BigInt(1024),
              ipniPiece: false,
              ipniIpfs: false,
              storagePricePerTibPerMonth: BigInt(2000000),
              minProvingPeriodInEpochs: 2880,
              location: 'EU-WEST',
              paymentTokenAddress: ethers.ZeroAddress,
            },
          },
        },
      }),
    ],
    throwOnApproval = false,
  } = options

  const originalCall = provider.call

  provider.call = async (transaction: any) => {
    const data = transaction.data
    const to = transaction.to?.toLowerCase()

    // Handle Multicall3 aggregate3 calls
    if (to === CONTRACT_ADDRESSES.MULTICALL3.calibration.toLowerCase() && data?.startsWith('0x82ad56cb')) {
      // First try to handle it with the default multicall mock
      // This handles the basic WarmStorage address discovery
      const defaultResult = await originalCall.call(provider, transaction)
      if (defaultResult && defaultResult !== '0x') {
        // Decode to check if it's a valid multicall response
        try {
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
            ['tuple(bool success, bytes returnData)[]'],
            defaultResult
          )
          // If it decoded successfully and has results, use the default
          if (decoded[0]?.length > 0) {
            return defaultResult
          }
        } catch {
          // Continue with our custom handling
        }
      }

      // Decode the multicall data for custom handling
      const iface = new ethers.Interface(CONTRACT_ABIS.MULTICALL3)
      const decoded = iface.decodeFunctionData('aggregate3', data)
      const calls = decoded[0]

      // Process each call and return mock results
      const results = calls.map((call: any) => {
        const callData = call.callData
        const target = call.target?.toLowerCase()

        // Handle calls to WarmStorage contract for address discovery
        // Check if it's to the WarmStorage address (could be to the actual address)
        if (
          target === CONTRACT_ADDRESSES.WARM_STORAGE.calibration.toLowerCase() ||
          target === '0xe6cd6d7becd21fbf72452cf8371e505b02134669'
        ) {
          // Mock pdpVerifierAddress
          if (callData.startsWith('0xe5c9821e')) {
            return {
              success: true,
              returnData: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [MOCK_ADDRESSES.PDP_VERIFIER]),
            }
          }
          // Mock paymentsContractAddress
          if (callData.startsWith('0x8b893d6f')) {
            return {
              success: true,
              returnData: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [MOCK_ADDRESSES.PAYMENTS]),
            }
          }
          // Mock usdfcTokenAddress
          if (callData.startsWith('0x8e2bc1ea')) {
            return {
              success: true,
              returnData: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [CONTRACT_ADDRESSES.USDFC.calibration]),
            }
          }
          // Mock filCDNAddress
          if (callData.startsWith('0xf699dd7e')) {
            return {
              success: true,
              returnData: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [ethers.ZeroAddress]),
            }
          }
          // Mock viewContractAddress
          if (callData.startsWith('0x7a9ebc15')) {
            return {
              success: true,
              returnData: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [MOCK_ADDRESSES.WARM_STORAGE_VIEW]),
            }
          }
          // Mock serviceProviderRegistry
          if (callData.startsWith('0xab2b3ae5')) {
            return {
              success: true,
              returnData: ethers.AbiCoder.defaultAbiCoder().encode(
                ['address'],
                ['0x0000000000000000000000000000000000000001']
              ),
            }
          }
        }

        // Handle calls to WarmStorageView contract for getApprovedProviders
        if (target === MOCK_ADDRESSES.WARM_STORAGE_VIEW.toLowerCase()) {
          // Mock getApprovedProviders() - returns array of provider IDs
          if (callData.startsWith('0x266afe1b')) {
            return {
              success: true,
              returnData: ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [approvedIds.map(BigInt)]),
            }
          }
        }

        // Mock getProvider(uint256) calls to SPRegistry
        // Check if it's to the SPRegistry address
        if (callData.startsWith('0x5c42d079') && target === '0x0000000000000000000000000000000000000001') {
          const providerId = parseInt(callData.slice(10, 74), 16)
          const provider = providers.find((p) => p.id === providerId)
          if (provider) {
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(address serviceProvider, address payee, string name, string description, bool isActive)'],
              [[provider.serviceProvider, provider.payee, provider.name, provider.description || '', provider.active]]
            )
            return { success: true, returnData: encoded }
          }
          // Return empty provider
          const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address serviceProvider, address payee, string name, string description, bool isActive)'],
            [[ethers.ZeroAddress, ethers.ZeroAddress, '', '', false]]
          )
          return { success: true, returnData: encoded }
        }

        // Mock getPDPService(uint256) calls
        if (callData.startsWith('0xc439fd57') && target === '0x0000000000000000000000000000000000000001') {
          const providerId = parseInt(callData.slice(10, 74), 16)
          const provider = providers.find((p) => p.id === providerId)
          if (provider?.products?.PDP) {
            const pdp = provider.products.PDP
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
              [
                'tuple(tuple(string serviceURL, uint256 minPieceSizeInBytes, uint256 maxPieceSizeInBytes, bool ipniPiece, bool ipniIpfs, uint256 storagePricePerTibPerMonth, uint256 minProvingPeriodInEpochs, string location, address paymentTokenAddress) pdpOffering, string[] capabilityKeys, bool isActive)',
              ],
              [
                [
                  [
                    pdp.data.serviceURL,
                    pdp.data.minPieceSizeInBytes,
                    pdp.data.maxPieceSizeInBytes,
                    pdp.data.ipniPiece,
                    pdp.data.ipniIpfs,
                    pdp.data.storagePricePerTibPerMonth,
                    pdp.data.minProvingPeriodInEpochs,
                    pdp.data.location || '',
                    pdp.data.paymentTokenAddress,
                  ],
                  Object.keys(pdp.capabilities || {}),
                  pdp.isActive,
                ],
              ]
            )
            return { success: true, returnData: encoded }
          }
          // Return empty PDP service
          const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            [
              'tuple(tuple(string serviceURL, uint256 minPieceSizeInBytes, uint256 maxPieceSizeInBytes, bool ipniPiece, bool ipniIpfs, uint256 storagePricePerTibPerMonth, uint256 minProvingPeriodInEpochs, string location, address paymentTokenAddress) pdpOffering, string[] capabilityKeys, bool isActive)',
            ],
            [[['', BigInt(0), BigInt(0), false, false, BigInt(0), BigInt(0), '', ethers.ZeroAddress], [], false]]
          )
          return { success: true, returnData: encoded }
        }

        // Default: return failure
        return { success: false, returnData: '0x' }
      })

      return ethers.AbiCoder.defaultAbiCoder().encode(['tuple(bool success, bytes returnData)[]'], [results])
    }

    // Mock getApprovedProviders() - returns array of provider IDs (WarmStorageView)
    if (data?.startsWith('0x266afe1b')) {
      return ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [approvedIds.map(BigInt)])
    }

    // Mock getProvider(uint256) - returns provider info by ID (SPRegistry)
    // Function returns: tuple(address beneficiary, string name, string description, bool isActive)
    if (data?.startsWith('0x5c42d079')) {
      // Decode the provider ID from the call data
      const providerId = parseInt(data.slice(10, 74), 16)
      const provider = providers.find((p) => p.id === providerId)
      if (provider) {
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['tuple(address serviceProvider, address payee, string name, string description, bool isActive)'],
          [[provider.serviceProvider, provider.payee, provider.name, provider.description || '', provider.active]]
        )
      }
      // Return null provider (zero address indicates not found)
      return ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(address serviceProvider, address payee, string name, string description, bool isActive)'],
        [[ethers.ZeroAddress, ethers.ZeroAddress, '', '', false]]
      )
    }

    // Mock getPDPService(uint256) - returns PDP service info for provider
    if (data?.startsWith('0xc439fd57')) {
      const providerId = parseInt(data.slice(10, 74), 16)
      const provider = providers.find((p) => p.id === providerId)
      if (provider?.products?.PDP) {
        const pdp = provider.products.PDP
        // Return the struct with named fields as ethers expects
        const pdpOffering = {
          serviceURL: pdp.data.serviceURL,
          minPieceSizeInBytes: pdp.data.minPieceSizeInBytes,
          maxPieceSizeInBytes: pdp.data.maxPieceSizeInBytes,
          ipniPiece: pdp.data.ipniPiece,
          ipniIpfs: pdp.data.ipniIpfs,
          storagePricePerTibPerMonth: pdp.data.storagePricePerTibPerMonth,
          minProvingPeriodInEpochs: pdp.data.minProvingPeriodInEpochs,
          location: pdp.data.location || '',
          paymentTokenAddress: pdp.data.paymentTokenAddress,
        }

        return ethers.AbiCoder.defaultAbiCoder().encode(
          [
            'tuple(string serviceURL, uint256 minPieceSizeInBytes, uint256 maxPieceSizeInBytes, bool ipniPiece, bool ipniIpfs, uint256 storagePricePerTibPerMonth, uint256 minProvingPeriodInEpochs, string location, address paymentTokenAddress)',
            'string[]',
            'bool',
          ],
          [pdpOffering, [], pdp.isActive]
        )
      }
      // Return empty PDP service for provider without PDP
      const emptyPdpOffering = {
        serviceURL: '',
        minPieceSizeInBytes: BigInt(0),
        maxPieceSizeInBytes: BigInt(0),
        ipniPiece: false,
        ipniIpfs: false,
        storagePricePerTibPerMonth: BigInt(0),
        minProvingPeriodInEpochs: BigInt(0),
        location: '',
        paymentTokenAddress: ethers.ZeroAddress,
      }
      return ethers.AbiCoder.defaultAbiCoder().encode(
        [
          'tuple(string serviceURL, uint256 minPieceSizeInBytes, uint256 maxPieceSizeInBytes, bool ipniPiece, bool ipniIpfs, uint256 storagePricePerTibPerMonth, uint256 minProvingPeriodInEpochs, string location, address paymentTokenAddress)',
          'string[]',
          'bool',
        ],
        [emptyPdpOffering, [], false]
      )
    }

    // Mock getProviderProducts(uint256) - returns products for provider
    if (data?.startsWith('0xb5eb46e1')) {
      const providerId = parseInt(data.slice(10, 74), 16)
      const provider = providers.find((p) => p.id === providerId)
      if (provider?.products?.PDP) {
        const pdp = provider.products.PDP
        // Encode PDP product data (simplified for testing)
        const encodedPDP = ethers.AbiCoder.defaultAbiCoder().encode(
          ['string', 'uint256', 'uint256', 'bool', 'bool', 'uint256', 'uint256', 'string', 'address'],
          [
            pdp.data.serviceURL,
            pdp.data.minPieceSizeInBytes,
            pdp.data.maxPieceSizeInBytes,
            pdp.data.ipniPiece,
            pdp.data.ipniIpfs,
            pdp.data.storagePricePerTibPerMonth,
            pdp.data.minProvingPeriodInEpochs,
            pdp.data.location || '',
            pdp.data.paymentTokenAddress,
          ]
        )

        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['tuple(uint8,bool,bytes32[],bytes)[]'],
          [
            [
              [
                0, // productType: PDP
                pdp.isActive,
                [], // capabilityKeys (empty for simplicity)
                encodedPDP,
              ],
            ],
          ]
        )
      }
      // Return empty products array
      return ethers.AbiCoder.defaultAbiCoder().encode(['tuple(uint8,bool,bytes32[],bytes)[]'], [[]])
    }

    // Mock decodePDPOffering(bytes) - decode PDP product data
    if (data?.startsWith('0xdeb0e462')) {
      // For simplicity, return a default PDP offering
      const provider = providers[0]
      if (provider?.products?.PDP) {
        const pdp = provider.products.PDP
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['tuple(string,uint256,uint256,bool,bool,uint256,uint256,string,address)'],
          [
            [
              pdp.data.serviceURL,
              pdp.data.minPieceSizeInBytes,
              pdp.data.maxPieceSizeInBytes,
              pdp.data.ipniPiece,
              pdp.data.ipniIpfs,
              pdp.data.storagePricePerTibPerMonth,
              pdp.data.minProvingPeriodInEpochs,
              pdp.data.location || '',
              pdp.data.paymentTokenAddress,
            ],
          ]
        )
      }
    }

    // Mock getProviderIdByAddress
    if (data?.startsWith('0x93ecb91e')) {
      // Decode address from call data
      const addressParam = `0x${data.slice(34, 74)}`
      const provider = providers.find((p) => p.serviceProvider.toLowerCase() === addressParam.toLowerCase())
      if (provider) {
        return ethers.zeroPadValue(ethers.toBeHex(provider.id), 32)
      }
      return ethers.zeroPadValue('0x00', 32) // Provider ID 0 (not found)
    }

    // Mock getProviderByAddress - returns provider struct
    if (data?.startsWith('0x2335bde0')) {
      // Decode address from call data
      const addressParam = `0x${data.slice(34, 74)}`
      const provider = providers.find((p) => p.serviceProvider.toLowerCase() === addressParam.toLowerCase())
      if (provider) {
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['tuple(address serviceProvider, address payee, string name, string description, bool isActive)'],
          [[provider.serviceProvider, provider.payee, provider.name, provider.description || '', provider.active]]
        )
      }
      // Return zero address struct for not found
      return ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(address serviceProvider, address payee, string name, string description, bool isActive)'],
        [[ethers.ZeroAddress, ethers.ZeroAddress, '', '', false]]
      )
    }

    // Mock isProviderApproved - returns boolean (can be called on view contract)
    if (data?.startsWith('0xb6133b7a')) {
      const providerId = parseInt(data.slice(10, 74), 16)
      const isApproved = approvedIds.includes(providerId)
      return ethers.AbiCoder.defaultAbiCoder().encode(['bool'], [isApproved])
    }

    // Mock operatorApprovals (for allowances check) - override the default
    if (data?.startsWith('0xe3d4c69e')) {
      if (throwOnApproval) {
        throw new Error('No wallet connected')
      }
      // Return mock approval data
      return ethers.AbiCoder.defaultAbiCoder().encode(
        ['bool', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
        [
          true, // isApproved
          BigInt(1000000), // rateAllowance
          BigInt(10000000), // lockupAllowance
          BigInt(500000), // rateUsed
          BigInt(5000000), // lockupUsed
          BigInt(86400), // maxLockupPeriod
        ]
      )
    }

    // Fallback to original call
    return originalCall.call(provider, transaction)
  }

  // Return cleanup function
  return () => {
    provider.call = originalCall
  }
}

/**
 * Create a mock ProviderInfo object for testing
 */
export function createMockProviderInfo(overrides?: Partial<ProviderInfo>): ProviderInfo {
  const defaults: ProviderInfo = {
    id: 1,
    serviceProvider: MOCK_ADDRESSES.SIGNER,
    payee: MOCK_ADDRESSES.SIGNER, // Usually same as serviceProvider for tests
    name: 'Test Provider',
    description: 'A test storage provider',
    active: true,
    products: {
      PDP: {
        type: 'PDP',
        isActive: true,
        capabilities: {},
        data: {
          serviceURL: 'https://provider.example.com',
          minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
          maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
          ipniPiece: false,
          ipniIpfs: false,
          storagePricePerTibPerMonth: BigInt(1000000),
          minProvingPeriodInEpochs: 2880,
          location: 'US',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      },
    },
  }

  return { ...defaults, ...overrides }
}

/**
 * Create a mock provider with minimal fields (for backward compatibility)
 */
export function createSimpleProvider(props: {
  address?: string
  serviceProvider?: string
  serviceURL: string
}): ProviderInfo {
  return createMockProviderInfo({
    serviceProvider: props.serviceProvider ?? props.address ?? MOCK_ADDRESSES.SIGNER,
    products: {
      PDP: {
        type: 'PDP',
        isActive: true,
        capabilities: {},
        data: {
          serviceURL: props.serviceURL,
          minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
          maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
          ipniPiece: false,
          ipniIpfs: false,
          storagePricePerTibPerMonth: BigInt(1000000),
          minProvingPeriodInEpochs: 2880,
          location: 'US',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      },
    },
  })
}
