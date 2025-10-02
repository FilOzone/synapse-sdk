/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type getNextPieceId = ExtractAbiFunction<typeof CONTRACT_ABIS.PDP_VERIFIER, 'getNextPieceId'>
export type dataSetLive = ExtractAbiFunction<typeof CONTRACT_ABIS.PDP_VERIFIER, 'dataSetLive'>
export type getDataSetListener = ExtractAbiFunction<typeof CONTRACT_ABIS.PDP_VERIFIER, 'getDataSetListener'>

export interface PDPVerifierOptions {
  dataSetLive?: (args: AbiToType<dataSetLive['inputs']>) => AbiToType<dataSetLive['outputs']>
  getDataSetListener?: (args: AbiToType<getDataSetListener['inputs']>) => AbiToType<getDataSetListener['outputs']>
  getNextPieceId?: (args: AbiToType<getNextPieceId['inputs']>) => AbiToType<getNextPieceId['outputs']>
}

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
    case 'dataSetLive': {
      if (!options.pdpVerifier?.dataSetLive) {
        throw new Error('PDP Verifier: dataSetLive is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PDP_VERIFIER.find((abi) => abi.type === 'function' && abi.name === 'dataSetLive')!.outputs,
        options.pdpVerifier.dataSetLive(args)
      )
    }

    case 'getDataSetListener':
      if (!options.pdpVerifier?.getDataSetListener) {
        throw new Error('PDP Verifier: getDataSetListener is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PDP_VERIFIER.find((abi) => abi.type === 'function' && abi.name === 'getDataSetListener')!.outputs,
        options.pdpVerifier.getDataSetListener(args)
      )
    case 'getNextPieceId':
      if (!options.pdpVerifier?.getNextPieceId) {
        throw new Error('PDP Verifier: getNextPieceId is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PDP_VERIFIER.find((abi) => abi.type === 'function' && abi.name === 'getNextPieceId')!.outputs,
        options.pdpVerifier.getNextPieceId(args)
      )
    default: {
      throw new Error(`PDP Verifier: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
