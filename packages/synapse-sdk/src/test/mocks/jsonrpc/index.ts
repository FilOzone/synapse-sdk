import { HttpResponse, http } from 'msw'
import type { RequiredDeep } from 'type-fest'
import {
  type Address,
  bytesToHex,
  decodeFunctionData,
  encodeAbiParameters,
  type Hex,
  isAddressEqual,
  multicall3Abi,
  numberToBytes,
  parseUnits,
  stringToHex,
} from 'viem'
import { CONTRACT_ADDRESSES, TIME_CONSTANTS } from '../../../utils/constants.ts'
import { paymentsCallHandler } from './payments.ts'
import { pdpVerifierCallHandler } from './pdp.ts'
import { serviceProviderRegistryCallHandler } from './service-registry.ts'
import { sessionKeyRegistryCallHandler } from './session-key-registry.ts'
import type { JSONRPCOptions, RpcRequest, RpcResponse } from './types.ts'
import { warmStorageCallHandler, warmStorageViewCallHandler } from './warm-storage.ts'

export const PRIVATE_KEYS = {
  key1: '0x1234567890123456789012345678901234567890123456789012345678901234',
  key2: '0x4123456789012345678901234567890123456789012345678901234567890123',
}
export const ADDRESSES = {
  client1: '0x2e988A386a799F506693793c6A5AF6B54dfAaBfB' as Address,
  zero: '0x0000000000000000000000000000000000000000' as Address,
  serviceProvider1: '0x0000000000000000000000000000000000000001' as Address,
  serviceProvider2: '0x0000000000000000000000000000000000000002' as Address,
  payee1: '0x1000000000000000000000000000000000000001' as Address,
  mainnet: {
    warmStorage: '0x1234567890123456789012345678901234567890' as Address,
    multicall3: CONTRACT_ADDRESSES.MULTICALL3.mainnet,
    pdpVerifier: '0x9876543210987654321098765432109876543210',
  },
  calibration: {
    warmStorage: CONTRACT_ADDRESSES.WARM_STORAGE.calibration as Address,
    multicall3: CONTRACT_ADDRESSES.MULTICALL3.calibration,
    pdpVerifier: '0x3ce3C62C4D405d69738530A6A65E4b13E8700C48' as Address,
    payments: '0x80Df863d84eFaa0aaC8da2E9B08D14A7236ff4D0' as Address,
    usdfcToken: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0' as Address,
    filCDN: '0x0000000000000000000000000000000000000000' as Address,
    viewContract: '0x1996B60838871D0bc7980Bc02DD6Eb920535bE54' as Address,
    spRegistry: '0x0000000000000000000000000000000000000001' as Address,
    sessionKeyRegistry: '0x97Dd879F5a97A8c761B94746d7F5cfF50AAd4452' as Address,
  },
}

function jsonrpcHandler(item: RpcRequest, options?: JSONRPCOptions): RpcResponse {
  const { id } = item
  try {
    return {
      jsonrpc: '2.0',
      result: handler(item, options ?? {}),
      id: id ?? 1,
    }
  } catch (error) {
    if (options?.debug) {
      console.error(error)
    }
    return {
      jsonrpc: '2.0',
      error: {
        code: 11,
        message:
          error instanceof Error
            ? `message execution failed (exit=[33], revert reason=[message failed with backtrace:\n00: f0176092 (method 3844450837) -- contract reverted at 75 (33)\n01: f0176092 (method 6) -- contract reverted at 15151 (33)\n (RetCode=33)], vm error=[Error(${error.message})])`
            : 'Unknown error',
        data:
          error instanceof Error
            ? `0x08c379a0${encodeAbiParameters([{ type: 'string' }], [error.message]).slice(2)}`
            : '0x',
      },
      id: id ?? 1,
    }
  }
}

/**
 * Mock JSONRPC server for testing
 */
export function JSONRPC(options?: JSONRPCOptions) {
  return http.post<Record<string, any>, RpcRequest | RpcRequest[], RpcResponse | RpcResponse[]>(
    'https://api.calibration.node.glif.io/rpc/v1',
    async ({ request }) => {
      const body = await request.json()
      if (Array.isArray(body)) {
        const results: RpcResponse[] = []
        for (const item of body) {
          results.push(jsonrpcHandler(item, options))
        }
        return HttpResponse.json(results)
      } else {
        return HttpResponse.json(jsonrpcHandler(body, options))
      }
    }
  )
}

/**
 * Handle all calls
 */
function handler(body: RpcRequest, options: JSONRPCOptions) {
  const { method, params } = body
  switch (method) {
    case 'eth_chainId': {
      if (!options.eth_chainId) {
        throw new Error('eth_chainId is not defined')
      }
      return options.eth_chainId
    }
    case 'eth_blockNumber': {
      if (!options.eth_blockNumber) {
        throw new Error('eth_blockNumber is not defined')
      }
      return options.eth_blockNumber
    }
    case 'eth_accounts':
      if (!options.eth_accounts) {
        throw new Error('eth_accounts is not defined')
      }
      return options.eth_accounts
    case 'eth_getTransactionByHash': {
      if (!options.eth_getTransactionByHash) {
        throw new Error('eth_getTransactionByHash is not defined')
      }
      return options.eth_getTransactionByHash(params)
    }
    case 'eth_getTransactionReceipt': {
      if (!options.eth_getTransactionReceipt) {
        throw new Error('eth_getTransactionReceipt is not defined')
      }
      return options.eth_getTransactionReceipt(params)
    }
    case 'eth_call': {
      const { to, data } = params[0]

      if (
        isAddressEqual(ADDRESSES.calibration.warmStorage, to as Address) ||
        isAddressEqual(ADDRESSES.mainnet.warmStorage, to as Address)
      ) {
        return warmStorageCallHandler(data as Hex, options)
      }

      if (isAddressEqual(CONTRACT_ADDRESSES.MULTICALL3.calibration, to as Address)) {
        return multicall3CallHandler(data as Hex, options)
      }

      if (isAddressEqual(ADDRESSES.calibration.spRegistry, to as Address)) {
        return serviceProviderRegistryCallHandler(data as Hex, options)
      }

      if (isAddressEqual(ADDRESSES.calibration.sessionKeyRegistry, to as Address)) {
        return sessionKeyRegistryCallHandler(data as Hex, options)
      }

      if (isAddressEqual(ADDRESSES.calibration.viewContract, to as Address)) {
        return warmStorageViewCallHandler(data as Hex, options)
      }

      if (isAddressEqual(ADDRESSES.calibration.pdpVerifier, to as Address)) {
        return pdpVerifierCallHandler(data as Hex, options)
      }

      if (isAddressEqual(ADDRESSES.calibration.payments, to as Address)) {
        return paymentsCallHandler(data as Hex, options)
      }

      throw new Error(`Unknown eth_call to address: ${to}`)
    }
    case 'eth_signTypedData_v4': {
      if (!options.eth_signTypedData_v4) {
        throw new Error('eth_signTypedData_v4 is not defined')
      }
      return options.eth_signTypedData_v4(params)
    }
    default: {
      throw new Error(`Unknown method: ${method}`)
    }
  }
}

function multicall3CallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const decoded = decodeFunctionData({
    abi: multicall3Abi,
    data: data as Hex,
  })

  const results = []

  for (const arg of decoded.args[0] ?? []) {
    results.push(
      handler(
        {
          method: 'eth_call',
          params: [
            {
              to: arg.target,
              data: arg.callData,
            },
          ],
        },
        options
      )
    )
  }

  const result = encodeAbiParameters(
    [
      {
        components: [
          {
            name: 'success',
            type: 'bool',
          },
          {
            name: 'returnData',
            type: 'bytes',
          },
        ],
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    [
      results.map((result) => ({
        success: true,
        returnData: result as Hex,
      })),
    ]
  )
  return result
}

export const presets = {
  basic: {
    debug: false,
    eth_chainId: '0x4cb2f', // 314159
    eth_blockNumber: '0x127001',
    eth_accounts: [ADDRESSES.client1],
    eth_getTransactionByHash: () => {
      throw new Error('eth_getTransactionByHash undefined')
    },
    eth_getTransactionReceipt: () => {
      throw new Error('eth_getTransactionReceipt undefined')
    },
    eth_signTypedData_v4: () => {
      throw new Error('eth_signTypedData_v4 undefined')
    },
    warmStorage: {
      pdpVerifierAddress: () => [ADDRESSES.calibration.pdpVerifier],
      paymentsContractAddress: () => [ADDRESSES.calibration.payments],
      usdfcTokenAddress: () => [ADDRESSES.calibration.usdfcToken],
      filBeamBeneficiaryAddress: () => [ADDRESSES.calibration.filCDN],
      viewContractAddress: () => [ADDRESSES.calibration.viewContract],
      serviceProviderRegistry: () => [ADDRESSES.calibration.spRegistry],
      sessionKeyRegistry: () => [ADDRESSES.calibration.sessionKeyRegistry],
      getServicePrice: () => [
        {
          pricePerTiBPerMonthNoCDN: parseUnits('2', 18),
          pricePerTiBCdnEgress: parseUnits('7', 18),
          pricePerTiBCacheMissEgress: parseUnits('7', 18),
          minimumPricePerMonth: parseUnits('6', 16),
          tokenAddress: ADDRESSES.calibration.usdfcToken,
          epochsPerMonth: TIME_CONSTANTS.EPOCHS_PER_MONTH,
        },
      ],
    },
    warmStorageView: {
      isProviderApproved: () => [true],
      // Keep legacy getters to satisfy RequiredDeep typing and backward-compat tests
      getClientDataSets: () => [
        [
          {
            pdpRailId: 1n,
            cacheMissRailId: 0n,
            cdnRailId: 0n,
            payer: ADDRESSES.client1,
            payee: ADDRESSES.serviceProvider1,
            serviceProvider: ADDRESSES.serviceProvider1,
            commissionBps: 100n,
            clientDataSetId: 0n,
            pdpEndEpoch: 0n,
            providerId: 1n,
            cdnEndEpoch: 0n,
            dataSetId: 1n,
          },
        ],
      ],
      railToDataSet: () => [1n],
      clientDataSets: () => [[1n]],
      getDataSet: () => [
        {
          pdpRailId: 1n,
          cacheMissRailId: 0n,
          cdnRailId: 0n,
          payer: ADDRESSES.client1,
          payee: ADDRESSES.serviceProvider1,
          serviceProvider: ADDRESSES.serviceProvider1,
          commissionBps: 100n,
          clientDataSetId: 0n,
          pdpEndEpoch: 0n,
          providerId: 1n,
          cdnEndEpoch: 0n,
          dataSetId: 1n,
        },
      ],
      getApprovedProviders: () => [[1n, 2n]],
      getAllDataSetMetadata: (args) => {
        const [dataSetId] = args
        if (dataSetId === 1n) {
          return [
            ['environment', 'withCDN'], // keys
            ['test', ''], // values
          ]
        }
        return [[], []] // empty metadata for other data sets
      },
      getDataSetMetadata: (args) => {
        const [dataSetId, key] = args
        if (dataSetId === 1n && key === 'withCDN') return [true, '']
        if (dataSetId === 1n && key === 'environment') return [true, 'test']
        return [false, ''] // key not found
      },
      getAllPieceMetadata: (args) => {
        const [dataSetId, pieceId] = args
        if (dataSetId === 1n && pieceId === 0n) {
          return [
            ['withIPFSIndexing', 'ipfsRootCID'], // keys
            ['', 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'], // values
          ]
        }
        return [[], []] // empty metadata for other pieces
      },
      getPieceMetadata: (args) => {
        const [dataSetId, pieceId, key] = args
        if (dataSetId === 1n && pieceId === 0n && key === 'withIPFSIndexing') return [true, '']
        if (dataSetId === 1n && pieceId === 0n && key === 'ipfsRootCID')
          return [true, 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi']
        return [false, ''] // key not found
      },
      clientNonces: () => {
        return [BigInt(0)]
      },
    },
    pdpVerifier: {
      dataSetLive: () => [true],
      getDataSetListener: () => [ADDRESSES.calibration.warmStorage],
      getNextPieceId: () => [2n],
      getActivePieces: () => [[], [], false],
      getDataSetStorageProvider: () => [ADDRESSES.serviceProvider1, ADDRESSES.zero],
      getDataSetLeafCount: () => [0n],
    },
    serviceRegistry: {
      getProviderByAddress: (data) => [
        {
          providerId: 1n,
          info: {
            serviceProvider: data[0],
            payee: ADDRESSES.payee1,
            isActive: true,
            name: 'Test Provider',
            description: 'Test Provider',
          },
        },
      ],
      getProviderIdByAddress: () => [1n],
      getProvider: (data) => {
        if (data[0] === 1n) {
          return [
            {
              providerId: 1n,
              info: {
                serviceProvider: ADDRESSES.serviceProvider1,
                payee: ADDRESSES.payee1,
                isActive: true,
                name: 'Test Provider',
                description: 'Test Provider',
              },
            },
          ]
        }
        if (data[0] === 2n) {
          return [
            {
              providerId: 2n,
              info: {
                serviceProvider: ADDRESSES.serviceProvider2,
                payee: ADDRESSES.payee1,
                isActive: true,
                name: 'Test Provider',
                description: 'Test Provider',
              },
            },
          ]
        }
        return [
          {
            providerId: 0n,
            info: {
              serviceProvider: ADDRESSES.zero,
              payee: ADDRESSES.zero,
              isActive: false,
              name: '',
              description: '',
            },
          },
        ]
      },
      getProvidersByProductType: () => [
        {
          providers: [
            {
              providerId: 1n,
              providerInfo: {
                serviceProvider: ADDRESSES.serviceProvider1,
                payee: ADDRESSES.payee1,
                name: 'Test Provider 1',
                description: 'Test Provider 1',
                isActive: true,
              },
              product: {
                productType: 0,
                capabilityKeys: [
                  'serviceURL',
                  'minPieceSizeInBytes',
                  'maxPieceSizeInBytes',
                  'storagePricePerTibPerDay',
                  'minProvingPeriodInEpochs',
                  'location',
                  'paymentTokenAddress',
                ],
                isActive: true,
              },
              productCapabilityValues: [
                stringToHex('https://pdp.example.com'),
                bytesToHex(numberToBytes(1024n)),
                bytesToHex(numberToBytes(1024n)),
                bytesToHex(numberToBytes(1000000n)),
                bytesToHex(numberToBytes(2880n)),
                stringToHex('US'),
                ADDRESSES.calibration.usdfcToken,
              ],
            },
            {
              providerId: 2n,
              providerInfo: {
                serviceProvider: ADDRESSES.serviceProvider2,
                payee: ADDRESSES.payee1,
                name: 'Test Provider 2',
                description: 'Test Provider 2',
                isActive: true,
              },
              product: {
                productType: 0,
                capabilityKeys: [
                  'serviceURL',
                  'minPieceSizeInBytes',
                  'maxPieceSizeInBytes',
                  'storagePricePerTibPerDay',
                  'minProvingPeriodInEpochs',
                  'location',
                  'paymentTokenAddress',
                ],
                isActive: true,
              },
              productCapabilityValues: [
                stringToHex('https://pdp.example.com'),
                bytesToHex(numberToBytes(1024n)),
                bytesToHex(numberToBytes(1024n)),
                bytesToHex(numberToBytes(1000000n)),
                bytesToHex(numberToBytes(2880n)),
                stringToHex('US'),
                ADDRESSES.calibration.usdfcToken,
              ],
            },
          ],
          hasMore: false,
        },
      ],
      getProviderWithProduct: (data) => {
        const [providerId, productType] = data
        let providerInfo: {
          serviceProvider: Hex
          payee: Hex
          name: string
          description: string
          isActive: boolean
        }
        if (providerId === 1n) {
          providerInfo = {
            serviceProvider: ADDRESSES.serviceProvider1,
            payee: ADDRESSES.payee1,
            isActive: true,
            name: 'Test Provider',
            description: 'Test Provider',
          }
        } else if (providerId === 2n) {
          providerInfo = {
            serviceProvider: ADDRESSES.serviceProvider2,
            payee: ADDRESSES.payee1,
            isActive: true,
            name: 'Test Provider',
            description: 'Test Provider',
          }
        } else {
          // TODO throw if !providerExists
          providerInfo = {
            serviceProvider: ADDRESSES.zero,
            payee: ADDRESSES.zero,
            name: '',
            description: '',
            isActive: false,
          }
          return [
            {
              providerId,
              providerInfo,
              product: {
                productType: 0,
                capabilityKeys: [],
                isActive: false,
              },
              productCapabilityValues: [] as Hex[],
            },
          ]
        }
        return [
          {
            providerId,
            providerInfo,
            product: {
              productType,
              capabilityKeys: [
                'serviceURL',
                'minPieceSizeInBytes',
                'maxPieceSizeInBytes',
                'storagePricePerTibPerDay',
                'minProvingPeriodInEpochs',
                'location',
                'paymentTokenAddress',
              ],
              isActive: true,
            },
            productCapabilityValues: [
              stringToHex('https://pdp.example.com'),
              bytesToHex(numberToBytes(1024n)),
              bytesToHex(numberToBytes(1024n)),
              bytesToHex(numberToBytes(1000000n)),
              bytesToHex(numberToBytes(2880n)),
              stringToHex('US'),
              ADDRESSES.calibration.usdfcToken,
            ],
          },
        ]
      },
    },
    sessionKeyRegistry: {
      authorizationExpiry: () => [BigInt(0)],
    },
    payments: {
      operatorApprovals: () => [
        true, // isApproved
        BigInt(1000000), // rateAllowance
        BigInt(10000000), // lockupAllowance
        BigInt(500000), // rateUsed
        BigInt(5000000), // lockupUsed
        BigInt(86400), // maxLockupPeriod
      ],
      accounts: () => [BigInt(0), BigInt(0), BigInt(0), BigInt(0)],
    },
  } as RequiredDeep<JSONRPCOptions>,
}
