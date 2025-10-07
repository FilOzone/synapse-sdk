import type { AbiParameter, AbiParameterKind, AbiParametersToPrimitiveTypes } from 'abitype'
import type { PaymentsOptions } from './payments.ts'
import type { PDPVerifierOptions } from './pdp.ts'
import type { ServiceRegistryOptions } from './service-registry.ts'
import type { SessionKeyRegistryOptions } from './session-key-registry.ts'
import type { WarmStorageOptions, WarmStorageViewOptions } from './warm-storage.ts'

/**
 * Alias for AbiParametersToPrimitiveTypes
 */
export type AbiToType<
  abiParameters extends readonly AbiParameter[],
  abiParameterKind extends AbiParameterKind = AbiParameterKind,
> = AbiParametersToPrimitiveTypes<abiParameters, abiParameterKind>

/**
 * Options for the JSONRPC server
 */
export interface JSONRPCOptions {
  debug?: boolean
  eth_chainId?: string
  eth_blockNumber?: string
  eth_getTransactionByHash?: (params: any) => any
  eth_getTransactionReceipt?: (params: any) => any
  eth_signTypedData_v4?: (params: any) => string
  eth_accounts?: string[]
  warmStorage?: WarmStorageOptions
  pdpVerifier?: PDPVerifierOptions
  payments?: PaymentsOptions
  warmStorageView?: WarmStorageViewOptions
  serviceRegistry?: ServiceRegistryOptions
  sessionKeyRegistry?: SessionKeyRegistryOptions
}

/**
 * JSONRPC types
 */

/**
 * Success result
 */
export type SuccessResult<result> = {
  method?: undefined
  result: result
  error?: undefined
}

/**
 * Error result
 */
export type ErrorResult<error> = {
  method?: undefined
  result?: undefined
  error: error
}

/**
 * Subscription
 */
export type Subscription<result, error> = {
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

/**
 * RPC response
 */
export type RpcResponse<result = any, error = any> = {
  jsonrpc: `${number}`
  id: number
} & (SuccessResult<result> | ErrorResult<error> | Subscription<result, error>)

/**
 * RPC request
 */
export type RpcRequest = {
  jsonrpc?: '2.0' | undefined
  method: string
  params?: any | undefined
  id?: number | undefined
}
