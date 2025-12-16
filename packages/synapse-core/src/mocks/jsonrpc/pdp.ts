/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import * as Abis from '../../abis/index.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type getNextPieceId = ExtractAbiFunction<typeof Abis.pdp, 'getNextPieceId'>
export type dataSetLive = ExtractAbiFunction<typeof Abis.pdp, 'dataSetLive'>
export type getDataSetListener = ExtractAbiFunction<typeof Abis.pdp, 'getDataSetListener'>
export type getActivePieces = ExtractAbiFunction<typeof Abis.pdp, 'getActivePieces'>
export type getDataSetStorageProvider = ExtractAbiFunction<typeof Abis.pdp, 'getDataSetStorageProvider'>
export type getDataSetLeafCount = ExtractAbiFunction<typeof Abis.pdp, 'getDataSetLeafCount'>
export type getScheduledRemovals = ExtractAbiFunction<typeof Abis.pdp, 'getScheduledRemovals'>

export interface PDPVerifierOptions {
  dataSetLive?: (args: AbiToType<dataSetLive['inputs']>) => AbiToType<dataSetLive['outputs']>
  getDataSetListener?: (args: AbiToType<getDataSetListener['inputs']>) => AbiToType<getDataSetListener['outputs']>
  getNextPieceId?: (args: AbiToType<getNextPieceId['inputs']>) => AbiToType<getNextPieceId['outputs']>
  getActivePieces?: (args: AbiToType<getActivePieces['inputs']>) => AbiToType<getActivePieces['outputs']>
  getDataSetStorageProvider?: (
    args: AbiToType<getDataSetStorageProvider['inputs']>
  ) => AbiToType<getDataSetStorageProvider['outputs']>
  getDataSetLeafCount?: (args: AbiToType<getDataSetLeafCount['inputs']>) => AbiToType<getDataSetLeafCount['outputs']>
  getScheduledRemovals?: (args: AbiToType<getScheduledRemovals['inputs']>) => AbiToType<getScheduledRemovals['outputs']>
}

/**
 * Handle pdp verifier calls
 */
export function pdpVerifierCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: Abis.pdp,
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
        Abis.pdp.find((abi) => abi.type === 'function' && abi.name === 'dataSetLive')!.outputs,
        options.pdpVerifier.dataSetLive(args)
      )
    }

    case 'getDataSetListener':
      if (!options.pdpVerifier?.getDataSetListener) {
        throw new Error('PDP Verifier: getDataSetListener is not defined')
      }
      return encodeAbiParameters(
        Abis.pdp.find((abi) => abi.type === 'function' && abi.name === 'getDataSetListener')!.outputs,
        options.pdpVerifier.getDataSetListener(args)
      )
    case 'getNextPieceId':
      if (!options.pdpVerifier?.getNextPieceId) {
        throw new Error('PDP Verifier: getNextPieceId is not defined')
      }
      return encodeAbiParameters(
        Abis.pdp.find((abi) => abi.type === 'function' && abi.name === 'getNextPieceId')!.outputs,
        options.pdpVerifier.getNextPieceId(args)
      )
    case 'getActivePieces': {
      if (!options.pdpVerifier?.getActivePieces) {
        throw new Error('PDP Verifier: getActivePieces is not defined')
      }
      return encodeAbiParameters(
        Abis.pdp.find((abi) => abi.type === 'function' && abi.name === 'getActivePieces')!.outputs,
        options.pdpVerifier.getActivePieces(args)
      )
    }
    case 'getDataSetStorageProvider': {
      if (!options.pdpVerifier?.getDataSetStorageProvider) {
        throw new Error('PDP Verifier: getDataSetStorageProvider is not defined')
      }
      return encodeAbiParameters(
        Abis.pdp.find((abi) => abi.type === 'function' && abi.name === 'getDataSetStorageProvider')!.outputs,
        options.pdpVerifier.getDataSetStorageProvider(args)
      )
    }
    case 'getDataSetLeafCount': {
      if (!options.pdpVerifier?.getDataSetLeafCount) {
        throw new Error('PDP Verifier: getDataSetLeafCount is not defined')
      }
      return encodeAbiParameters(
        Abis.pdp.find((abi) => abi.type === 'function' && abi.name === 'getDataSetLeafCount')!.outputs,
        options.pdpVerifier.getDataSetLeafCount(args)
      )
    }
    case 'getScheduledRemovals': {
      if (!options.pdpVerifier?.getScheduledRemovals) {
        throw new Error('PDP Verifier: getScheduledRemovals is not defined')
      }
      return encodeAbiParameters(
        Abis.pdp.find((abi) => abi.type === 'function' && abi.name === 'getScheduledRemovals')!.outputs,
        options.pdpVerifier.getScheduledRemovals(args)
      )
    }
    default: {
      throw new Error(`PDP Verifier: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
