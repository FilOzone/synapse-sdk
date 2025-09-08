/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import { ADDRESSES, type JSONRPCOptions } from './index.ts'

export type dataSetLiveInput = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.PDP_VERIFIER, 'dataSetLive'>['inputs']
>

export type getDataSetListenerInput = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.PDP_VERIFIER, 'getDataSetListener'>['inputs']
>

export type getNextPieceIdInput = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.PDP_VERIFIER, 'getNextPieceId'>['inputs']
>

/**
 * Handle pdp verifier calls
 */
export function pdpVerifierCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: CONTRACT_ABIS.PDP_VERIFIER,
    data: data as Hex,
  })

  if (options.debug) {
    console.debug('PDP Verifier: calling function', functionName, 'with args', args)
  }

  switch (functionName) {
    case 'dataSetLive':
      return encodeAbiParameters(
        CONTRACT_ABIS.PDP_VERIFIER.find((abi) => abi.type === 'function' && abi.name === 'dataSetLive')!.outputs,
        [options.pdpVerifier?.dataSetLive?.(args as dataSetLiveInput) ?? true]
      )

    case 'getDataSetListener':
      return encodeAbiParameters(
        CONTRACT_ABIS.PDP_VERIFIER.find((abi) => abi.type === 'function' && abi.name === 'getDataSetListener')!.outputs,
        [
          options.pdpVerifier?.getDataSetListener?.(args as getDataSetListenerInput) ??
            ADDRESSES.calibration.warmStorage,
        ]
      )
    case 'getNextPieceId':
      return encodeAbiParameters(
        CONTRACT_ABIS.PDP_VERIFIER.find((abi) => abi.type === 'function' && abi.name === 'getNextPieceId')!.outputs,
        [options.pdpVerifier?.getNextPieceId?.(args as getNextPieceIdInput) ?? 2n]
      )
    default: {
      throw new Error(`PDP Verifier: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
