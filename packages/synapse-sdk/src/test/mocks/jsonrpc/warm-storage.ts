/** biome-ignore-all lint/style/noNonNullAssertion: testing */
import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

/**
 * Warm Storage View ABI types
 */

export type isProviderApproved = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'isProviderApproved'>

export type railToDataSet = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'railToDataSet'>

export type getClientDataSets = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getClientDataSets'>

export type clientDataSets = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'clientDataSets'>

export type getDataSet = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getDataSet'>

export type getApprovedProviders = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getApprovedProviders'>

export type getAllDataSetMetadata = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getAllDataSetMetadata'>

export type getDataSetMetadata = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getDataSetMetadata'>

export type getAllPieceMetadata = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getAllPieceMetadata'>

export type getPieceMetadata = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getPieceMetadata'>

export interface WarmStorageViewOptions {
  isProviderApproved?: (args: AbiToType<isProviderApproved['inputs']>) => AbiToType<isProviderApproved['outputs']>
  getClientDataSets?: (args: AbiToType<getClientDataSets['inputs']>) => AbiToType<getClientDataSets['outputs']>
  clientDataSets?: (args: AbiToType<clientDataSets['inputs']>) => AbiToType<clientDataSets['outputs']>
  getDataSet?: (args: AbiToType<getDataSet['inputs']>) => AbiToType<getDataSet['outputs']>
  railToDataSet?: (args: AbiToType<railToDataSet['inputs']>) => AbiToType<railToDataSet['outputs']>
  getApprovedProviders?: (args: AbiToType<getApprovedProviders['inputs']>) => AbiToType<getApprovedProviders['outputs']>
  getAllDataSetMetadata?: (
    args: AbiToType<getAllDataSetMetadata['inputs']>
  ) => AbiToType<getAllDataSetMetadata['outputs']>
  getDataSetMetadata?: (args: AbiToType<getDataSetMetadata['inputs']>) => AbiToType<getDataSetMetadata['outputs']>
  getAllPieceMetadata?: (args: AbiToType<getAllPieceMetadata['inputs']>) => AbiToType<getAllPieceMetadata['outputs']>
  getPieceMetadata?: (args: AbiToType<getPieceMetadata['inputs']>) => AbiToType<getPieceMetadata['outputs']>
}

/**
 * Warm Storage ABI types
 */

export type pdpVerifierAddress = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE, 'pdpVerifierAddress'>

export type paymentsContractAddress = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE, 'paymentsContractAddress'>

export type usdfcTokenAddress = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE, 'usdfcTokenAddress'>

export type filCDNBeneficiaryAddress = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE, 'filCDNBeneficiaryAddress'>

export type viewContractAddress = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE, 'viewContractAddress'>

export type serviceProviderRegistry = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE, 'serviceProviderRegistry'>

export type getServicePrice = ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE, 'getServicePrice'>

export interface WarmStorageOptions {
  pdpVerifierAddress?: (args: AbiToType<pdpVerifierAddress['inputs']>) => AbiToType<pdpVerifierAddress['outputs']>
  paymentsContractAddress?: (
    args: AbiToType<paymentsContractAddress['inputs']>
  ) => AbiToType<paymentsContractAddress['outputs']>
  usdfcTokenAddress?: (args: AbiToType<usdfcTokenAddress['inputs']>) => AbiToType<usdfcTokenAddress['outputs']>
  filCDNBeneficiaryAddress?: (
    args: AbiToType<filCDNBeneficiaryAddress['inputs']>
  ) => AbiToType<filCDNBeneficiaryAddress['outputs']>
  viewContractAddress?: (args: AbiToType<viewContractAddress['inputs']>) => AbiToType<viewContractAddress['outputs']>
  serviceProviderRegistry?: (
    args: AbiToType<serviceProviderRegistry['inputs']>
  ) => AbiToType<serviceProviderRegistry['outputs']>
  getServicePrice?: (args: AbiToType<getServicePrice['inputs']>) => AbiToType<getServicePrice['outputs']>
}

/**
 * Handle warm storage calls
 */
export function warmStorageCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: CONTRACT_ABIS.WARM_STORAGE,
    data: data as Hex,
  })

  if (options.debug) {
    console.debug('Warm Storage: calling function', functionName, 'with args', args)
  }
  switch (functionName) {
    case 'pdpVerifierAddress': {
      if (!options.warmStorage?.pdpVerifierAddress) {
        throw new Error('Warm Storage: pdpVerifierAddress is not defined')
      }
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        options.warmStorage.pdpVerifierAddress(args)
      )
    }
    case 'paymentsContractAddress': {
      if (!options.warmStorage?.paymentsContractAddress) {
        throw new Error('Warm Storage: paymentsContractAddress is not defined')
      }
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        options.warmStorage.paymentsContractAddress(args)
      )
    }
    case 'usdfcTokenAddress': {
      if (!options.warmStorage?.usdfcTokenAddress) {
        throw new Error('Warm Storage: usdfcTokenAddress is not defined')
      }
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        options.warmStorage.usdfcTokenAddress(args)
      )
    }
    case 'filCDNBeneficiaryAddress': {
      if (!options.warmStorage?.filCDNBeneficiaryAddress) {
        throw new Error('Warm Storage: filCDNBeneficiaryAddress is not defined')
      }
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        options.warmStorage.filCDNBeneficiaryAddress(args)
      )
    }
    case 'viewContractAddress': {
      if (!options.warmStorage?.viewContractAddress) {
        throw new Error('Warm Storage: viewContractAddress is not defined')
      }
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        options.warmStorage.viewContractAddress(args)
      )
    }

    case 'serviceProviderRegistry': {
      if (!options.warmStorage?.serviceProviderRegistry) {
        throw new Error('Warm Storage: serviceProviderRegistry is not defined')
      }
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        options.warmStorage.serviceProviderRegistry(args)
      )
    }

    case 'getServicePrice': {
      if (!options.warmStorage?.getServicePrice) {
        throw new Error('Warm Storage: getServicePrice is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE.find((abi) => abi.type === 'function' && abi.name === 'getServicePrice')!.outputs,
        options.warmStorage.getServicePrice(args)
      )
    }
    default: {
      throw new Error(`Warm Storage: unknown function: ${functionName} with args: ${args}`)
    }
  }
}

/**
 * Handle warm storage calls
 */
export function warmStorageViewCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: CONTRACT_ABIS.WARM_STORAGE_VIEW,
    data: data as Hex,
  })

  if (options.debug) {
    console.debug('Warm Storage View: calling function', functionName, 'with args', args)
  }

  switch (functionName) {
    case 'isProviderApproved': {
      if (!options.warmStorageView?.isProviderApproved) {
        throw new Error('Warm Storage View: isProviderApproved is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'isProviderApproved')!
          .outputs,
        options.warmStorageView.isProviderApproved(args)
      )
    }
    case 'getClientDataSets': {
      if (!options.warmStorageView?.getClientDataSets) {
        throw new Error('Warm Storage View: getClientDataSets is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'getClientDataSets')!
          .outputs,
        options.warmStorageView.getClientDataSets(args)
      )
    }

    case 'clientDataSets': {
      if (!options.warmStorageView?.clientDataSets) {
        throw new Error('Warm Storage View: clientDataSets is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'clientDataSets')!
          .outputs,
        options.warmStorageView.clientDataSets(args)
      )
    }

    case 'getDataSet': {
      if (!options.warmStorageView?.getDataSet) {
        throw new Error('Warm Storage View: getDataSet is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'getDataSet')!.outputs,
        options.warmStorageView.getDataSet(args)
      )
    }

    case 'railToDataSet': {
      if (!options.warmStorageView?.railToDataSet) {
        throw new Error('Warm Storage View: railToDataSet is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'railToDataSet')!.outputs,
        options.warmStorageView.railToDataSet(args)
      )
    }
    case 'getApprovedProviders': {
      if (!options.warmStorageView?.getApprovedProviders) {
        throw new Error('Warm Storage View: getApprovedProviders is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'getApprovedProviders')!
          .outputs,
        options.warmStorageView.getApprovedProviders(args)
      )
    }
    case 'getAllDataSetMetadata': {
      if (!options.warmStorageView?.getAllDataSetMetadata) {
        throw new Error('Warm Storage View: getAllDataSetMetadata is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'getAllDataSetMetadata')!
          .outputs,
        options.warmStorageView.getAllDataSetMetadata(args)
      )
    }
    case 'getDataSetMetadata': {
      if (!options.warmStorageView?.getDataSetMetadata) {
        throw new Error('Warm Storage View: getDataSetMetadata is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'getDataSetMetadata')!
          .outputs,
        options.warmStorageView.getDataSetMetadata(args)
      )
    }
    case 'getAllPieceMetadata': {
      if (!options.warmStorageView?.getAllPieceMetadata) {
        throw new Error('Warm Storage View: getAllPieceMetadata is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'getAllPieceMetadata')!
          .outputs,
        options.warmStorageView.getAllPieceMetadata(args)
      )
    }
    case 'getPieceMetadata': {
      if (!options.warmStorageView?.getPieceMetadata) {
        throw new Error('Warm Storage View: getPieceMetadata is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'getPieceMetadata')!
          .outputs,
        options.warmStorageView.getPieceMetadata(args)
      )
    }

    default: {
      throw new Error(`Warm Storage View: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
