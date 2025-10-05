import { HttpResponse, http } from 'msw'
import type { RequiredDeep } from 'type-fest'
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  type Hex,
  isAddressEqual,
  multicall3Abi,
  parseUnits,
} from 'viem'
import { CONTRACT_ADDRESSES, TIME_CONSTANTS } from '../../../utils/constants.ts'
import { paymentsCallHandler } from './payments.ts'
import { pdpVerifierCallHandler } from './pdp.ts'
import { serviceProviderRegistryCallHandler } from './service-registry.ts'
import type { JSONRPCOptions, RpcRequest, RpcResponse } from './types.ts'
import { warmStorageCallHandler, warmStorageViewCallHandler } from './warm-storage.ts'

export const PRIVATE_KEYS = {
  key1: '0x1234567890123456789012345678901234567890123456789012345678901234',
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
  },
}

/**
 * Mock JSONRPC server for testing
 */
export function JSONRPC(options?: JSONRPCOptions) {
  return http.post<Record<string, any>, RpcRequest | RpcRequest[], RpcResponse | RpcResponse[]>(
    'https://api.calibration.node.glif.io/rpc/v1',
    async ({ request }) => {
      try {
        const body = await request.json()
        if (Array.isArray(body)) {
          const results: RpcResponse[] = []
          for (const item of body) {
            const { id } = item
            const result = handler(item, options ?? {})
            results.push({
              jsonrpc: '2.0',
              result: result,
              id: id ?? 1,
            })
          }
          return HttpResponse.json(results)
        } else {
          const { id } = body
          return HttpResponse.json({
            jsonrpc: '2.0',
            result: handler(body, options ?? {}),
            id: id ?? 1,
          })
        }
      } catch (error) {
        if (options?.debug) {
          console.error(error)
        }
        return HttpResponse.json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          id: 1,
        })
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
    case 'eth_accounts':
      if (!options.eth_accounts) {
        throw new Error('eth_accounts is not defined')
      }
      return options.eth_accounts
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
    eth_chainId: '314159',
    eth_accounts: [ADDRESSES.client1],
    warmStorage: {
      pdpVerifierAddress: () => [ADDRESSES.calibration.pdpVerifier],
      paymentsContractAddress: () => [ADDRESSES.calibration.payments],
      usdfcTokenAddress: () => [ADDRESSES.calibration.usdfcToken],
      filCDNBeneficiaryAddress: () => [ADDRESSES.calibration.filCDN],
      viewContractAddress: () => [ADDRESSES.calibration.viewContract],
      serviceProviderRegistry: () => [ADDRESSES.calibration.spRegistry],
      getServicePrice: () => [
        {
          pricePerTiBPerMonthNoCDN: parseUnits('2', 18),
          pricePerTiBPerMonthWithCDN: parseUnits('3', 18),
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
    },
    pdpVerifier: {
      dataSetLive: () => [true],
      getDataSetListener: () => [ADDRESSES.calibration.warmStorage],
      getNextPieceId: () => [2n],
    },
    serviceRegistry: {
      getProviderByAddress: (data) => [
        {
          serviceProvider: data[0],
          payee: ADDRESSES.payee1,
          isActive: true,
          name: 'Test Provider',
          description: 'Test Provider',
          providerId: 1n,
        },
      ],
      getProviderIdByAddress: () => [1n],
      getPDPService: () => [
        {
          serviceURL: 'https://pdp.example.com',
          minPieceSizeInBytes: 1024n,
          maxPieceSizeInBytes: 1024n,
          ipniPiece: false,
          ipniIpfs: false,
          storagePricePerTibPerMonth: 1000000n,
          minProvingPeriodInEpochs: 2880n,
          location: 'US',
          paymentTokenAddress: ADDRESSES.calibration.usdfcToken,
        },
        [],
        true,
      ],
      getProvider: (data) => {
        if (data[0] === 1n) {
          return [
            {
              serviceProvider: ADDRESSES.serviceProvider1,
              payee: ADDRESSES.payee1,
              isActive: true,
              name: 'Test Provider',
              description: 'Test Provider',
              providerId: 1n,
            },
          ]
        }
        if (data[0] === 2n) {
          return [
            {
              serviceProvider: ADDRESSES.serviceProvider2,
              payee: ADDRESSES.payee1,
              isActive: true,
              name: 'Test Provider',
              description: 'Test Provider',
              providerId: 2n,
            },
          ]
        }
        return [
          {
            serviceProvider: ADDRESSES.zero,
            payee: ADDRESSES.zero,
            isActive: false,
            name: '',
            description: '',
            providerId: 0n,
          },
        ]
      },
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
    },
  } as RequiredDeep<JSONRPCOptions>,
}
