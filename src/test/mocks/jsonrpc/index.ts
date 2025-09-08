import { HttpResponse, http } from 'msw'
import { type Address, decodeFunctionData, encodeAbiParameters, type Hex, isAddressEqual, multicall3Abi } from 'viem'
import { CONTRACT_ADDRESSES } from '../../../utils/constants.ts'
import {
  type dataSetLiveInput,
  type getDataSetListenerInput,
  type getNextPieceIdInput,
  pdpVerifierCallHandler,
} from './pdp.ts'
import {
  type getProviderInput,
  type PDPOffering,
  type ProviderInfo,
  serviceProviderRegistryCallHandler,
} from './service-registry.ts'
import {
  type DataSetInfo,
  type getClientDataSetsInput,
  type isProviderApprovedInput,
  type railToDataSetInput,
  warmStorageCallHandler,
  warmStorageViewCallHandler,
} from './warm-storage.ts'

export const PRIVATE_KEYS = {
  key1: '0x1234567890123456789012345678901234567890123456789012345678901234',
}
export const ADDRESSES = {
  client1: '0x2e988A386a799F506693793c6A5AF6B54dfAaBfB' as Address,
  zero: '0x0000000000000000000000000000000000000000' as Address,
  serviceProvider1: '0x0000000000000000000000000000000000000001' as Address,
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

type SuccessResult<result> = {
  method?: undefined
  result: result
  error?: undefined
}
type ErrorResult<error> = {
  method?: undefined
  result?: undefined
  error: error
}
type Subscription<result, error> = {
  method: 'eth_subscription'
  error?: undefined
  result?: undefined
  params:
    | {
        subscription: string
        result: result
        error?: undefined
      }
    | {
        subscription: string
        result?: undefined
        error: error
      }
}
export type RpcResponse<result = any, error = any> = {
  jsonrpc: `${number}`
  id: number
} & (SuccessResult<result> | ErrorResult<error> | Subscription<result, error>)

export type RpcRequest = {
  jsonrpc?: '2.0' | undefined
  method: string
  params?: any | undefined
  id?: number | undefined
}
/**
 * Options for the JSONRPC server
 *
 * TODO: some types are not exactly correct we should make all input and outputs types strict and infered from the abi. all hooks should functions to override outputs based on inputs.
 */
export interface JSONRPCOptions {
  debug?: boolean
  eth_chainId?: string
  eth_accounts?: string[]
  eth_call?: {
    to: string
    data: string
  }
  warmStorage?: {
    pdpVerifierAddress?: Address
    paymentsContractAddress?: Address
    usdfcTokenAddress?: Address
    filCDNBeneficiaryAddress?: Address
    viewContractAddress?: Address
    serviceProviderRegistry?: Address
  }
  pdpVerifier?: {
    dataSetLive?: (args: dataSetLiveInput) => boolean
    getDataSetListener?: (args: getDataSetListenerInput) => Address
    getNextPieceId?: (args: getNextPieceIdInput) => bigint
  }
  warmStorageView?: {
    isProviderApproved?: (args: isProviderApprovedInput) => boolean
    getClientDataSets?: (args: getClientDataSetsInput) => DataSetInfo
    railToDataSet?: (args: railToDataSetInput) => [bigint]
  }
  serviceRegistry?: {
    getProviderByAddress?: ProviderInfo
    getProviderIdByAddress?: bigint
    getPDPService?: PDPOffering
    getProvider?: (args: getProviderInput) => ProviderInfo
  }
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
        console.error(error)
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
    case 'eth_chainId':
      return options.eth_chainId ?? '314159'
    case 'eth_accounts':
      return options.eth_accounts ?? ['0x1234567890123456789012345678901234567890']
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

  for (const arg of decoded.args[0]) {
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
