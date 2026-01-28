/** biome-ignore-all lint/style/noNonNullAssertion: testing */
import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import * as Abis from '../../abis/index.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

/**
 * Warm Storage View ABI types
 */

export type isProviderApproved = ExtractAbiFunction<typeof Abis.fwssView, 'isProviderApproved'>
export type railToDataSet = ExtractAbiFunction<typeof Abis.fwssView, 'railToDataSet'>
export type getClientDataSets = ExtractAbiFunction<typeof Abis.fwssView, 'getClientDataSets'>
export type clientDataSets = ExtractAbiFunction<typeof Abis.fwssView, 'clientDataSets'>
export type getDataSet = ExtractAbiFunction<typeof Abis.fwssView, 'getDataSet'>
export type getApprovedProviders = ExtractAbiFunction<typeof Abis.fwssView, 'getApprovedProviders'>
export type getAllDataSetMetadata = ExtractAbiFunction<typeof Abis.fwssView, 'getAllDataSetMetadata'>
export type getDataSetMetadata = ExtractAbiFunction<typeof Abis.fwssView, 'getDataSetMetadata'>
export type getAllPieceMetadata = ExtractAbiFunction<typeof Abis.fwssView, 'getAllPieceMetadata'>
export type getPieceMetadata = ExtractAbiFunction<typeof Abis.fwssView, 'getPieceMetadata'>
export type clientNonces = ExtractAbiFunction<typeof Abis.fwssView, 'clientNonces'>
export type getPDPConfig = ExtractAbiFunction<typeof Abis.fwssView, 'getPDPConfig'>

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
  clientNonces?: (args: AbiToType<clientNonces['inputs']>) => AbiToType<clientNonces['outputs']>
  getPDPConfig?: (args: AbiToType<getPDPConfig['inputs']>) => AbiToType<getPDPConfig['outputs']>
}

/**
 * Warm Storage ABI types
 */

export type addApprovedProvider = ExtractAbiFunction<typeof Abis.fwss, 'addApprovedProvider'>
export type removeApprovedProvider = ExtractAbiFunction<typeof Abis.fwss, 'removeApprovedProvider'>
export type pdpVerifierAddress = ExtractAbiFunction<typeof Abis.fwss, 'pdpVerifierAddress'>
export type paymentsContractAddress = ExtractAbiFunction<typeof Abis.fwss, 'paymentsContractAddress'>
export type usdfcTokenAddress = ExtractAbiFunction<typeof Abis.fwss, 'usdfcTokenAddress'>
export type filBeamBeneficiaryAddress = ExtractAbiFunction<typeof Abis.fwss, 'filBeamBeneficiaryAddress'>
export type viewContractAddress = ExtractAbiFunction<typeof Abis.fwss, 'viewContractAddress'>
export type serviceProviderRegistry = ExtractAbiFunction<typeof Abis.fwss, 'serviceProviderRegistry'>
export type sessionKeyRegistry = ExtractAbiFunction<typeof Abis.fwss, 'sessionKeyRegistry'>
export type getServicePrice = ExtractAbiFunction<typeof Abis.fwss, 'getServicePrice'>
export type owner = ExtractAbiFunction<typeof Abis.fwss, 'owner'>
export type terminateService = ExtractAbiFunction<typeof Abis.fwss, 'terminateService'>
export type topUpCDNPaymentRails = ExtractAbiFunction<typeof Abis.fwss, 'topUpCDNPaymentRails'>

export interface WarmStorageOptions {
  addApprovedProvider?: (args: AbiToType<addApprovedProvider['inputs']>) => AbiToType<addApprovedProvider['outputs']>
  removeApprovedProvider?: (
    args: AbiToType<removeApprovedProvider['inputs']>
  ) => AbiToType<removeApprovedProvider['outputs']>
  pdpVerifierAddress?: (args: AbiToType<pdpVerifierAddress['inputs']>) => AbiToType<pdpVerifierAddress['outputs']>
  paymentsContractAddress?: (
    args: AbiToType<paymentsContractAddress['inputs']>
  ) => AbiToType<paymentsContractAddress['outputs']>
  usdfcTokenAddress?: (args: AbiToType<usdfcTokenAddress['inputs']>) => AbiToType<usdfcTokenAddress['outputs']>
  filBeamBeneficiaryAddress?: (
    args: AbiToType<filBeamBeneficiaryAddress['inputs']>
  ) => AbiToType<filBeamBeneficiaryAddress['outputs']>
  viewContractAddress?: (args: AbiToType<viewContractAddress['inputs']>) => AbiToType<viewContractAddress['outputs']>
  serviceProviderRegistry?: (
    args: AbiToType<serviceProviderRegistry['inputs']>
  ) => AbiToType<serviceProviderRegistry['outputs']>
  sessionKeyRegistry?: (args: AbiToType<sessionKeyRegistry['inputs']>) => AbiToType<sessionKeyRegistry['outputs']>
  getServicePrice?: (args: AbiToType<getServicePrice['inputs']>) => AbiToType<getServicePrice['outputs']>
  owner?: (args: AbiToType<owner['inputs']>) => AbiToType<owner['outputs']>
  terminateService?: (args: AbiToType<terminateService['inputs']>) => AbiToType<terminateService['outputs']>
  topUpCDNPaymentRails?: (args: AbiToType<topUpCDNPaymentRails['inputs']>) => AbiToType<topUpCDNPaymentRails['outputs']>
}

/**
 * Handle warm storage calls
 */
export function warmStorageCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: Abis.fwss,
    data: data as Hex,
  })

  if (options.debug) {
    console.debug('Warm Storage: calling function', functionName, 'with args', args)
  }
  switch (functionName) {
    case 'addApprovedProvider': {
      if (!options.warmStorage?.addApprovedProvider) {
        throw new Error('Warm Storage: addApprovedProvider is not defined')
      }
      return encodeAbiParameters(
        Abis.fwss.find((abi) => abi.type === 'function' && abi.name === 'addApprovedProvider')!.outputs,
        options.warmStorage.addApprovedProvider(args)
      )
    }
    case 'removeApprovedProvider': {
      if (!options.warmStorage?.removeApprovedProvider) {
        throw new Error('Warm Storage: removeApprovedProvider is not defined')
      }
      return encodeAbiParameters(
        Abis.fwss.find((abi) => abi.type === 'function' && abi.name === 'removeApprovedProvider')!.outputs,
        options.warmStorage.removeApprovedProvider(args)
      )
    }
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
    case 'filBeamBeneficiaryAddress': {
      if (!options.warmStorage?.filBeamBeneficiaryAddress) {
        throw new Error('Warm Storage: filBeamBeneficiaryAddress is not defined')
      }
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        options.warmStorage.filBeamBeneficiaryAddress(args)
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

    case 'sessionKeyRegistry': {
      if (!options.warmStorage?.sessionKeyRegistry) {
        throw new Error('Warm Storage: sessionKeyRegistry is not defined')
      }
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        options.warmStorage.sessionKeyRegistry(args)
      )
    }

    case 'getServicePrice': {
      if (!options.warmStorage?.getServicePrice) {
        throw new Error('Warm Storage: getServicePrice is not defined')
      }
      return encodeAbiParameters(
        Abis.fwss.find((abi) => abi.type === 'function' && abi.name === 'getServicePrice')!.outputs,
        options.warmStorage.getServicePrice(args)
      )
    }

    case 'owner': {
      if (!options.warmStorage?.owner) {
        throw new Error('Warm Storage: owner is not defined')
      }
      return encodeAbiParameters(
        Abis.fwss.find((abi) => abi.type === 'function' && abi.name === 'owner')!.outputs,
        options.warmStorage.owner(args)
      )
    }

    case 'terminateService': {
      if (!options.warmStorage?.terminateService) {
        throw new Error('Warm Storage: terminateService is not defined')
      }
      return encodeAbiParameters(
        Abis.fwss.find((abi) => abi.type === 'function' && abi.name === 'terminateService')!.outputs,
        options.warmStorage.terminateService(args)
      )
    }
    case 'topUpCDNPaymentRails': {
      if (!options.warmStorage?.topUpCDNPaymentRails) {
        throw new Error('Warm Storage: topUpCDNPaymentRails is not defined')
      }
      return encodeAbiParameters(
        Abis.fwss.find((abi) => abi.type === 'function' && abi.name === 'topUpCDNPaymentRails')!.outputs,
        options.warmStorage.topUpCDNPaymentRails(args)
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
    abi: Abis.fwssView,
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
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'isProviderApproved')!.outputs,
        options.warmStorageView.isProviderApproved(args)
      )
    }
    case 'getClientDataSets': {
      if (!options.warmStorageView?.getClientDataSets) {
        throw new Error('Warm Storage View: getClientDataSets is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'getClientDataSets')!.outputs,
        options.warmStorageView.getClientDataSets(args)
      )
    }

    case 'clientDataSets': {
      if (!options.warmStorageView?.clientDataSets) {
        throw new Error('Warm Storage View: clientDataSets is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'clientDataSets')!.outputs,
        options.warmStorageView.clientDataSets(args)
      )
    }

    case 'getDataSet': {
      if (!options.warmStorageView?.getDataSet) {
        throw new Error('Warm Storage View: getDataSet is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'getDataSet')!.outputs,
        options.warmStorageView.getDataSet(args)
      )
    }

    case 'railToDataSet': {
      if (!options.warmStorageView?.railToDataSet) {
        throw new Error('Warm Storage View: railToDataSet is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'railToDataSet')!.outputs,
        options.warmStorageView.railToDataSet(args)
      )
    }
    case 'getApprovedProviders': {
      if (!options.warmStorageView?.getApprovedProviders) {
        throw new Error('Warm Storage View: getApprovedProviders is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'getApprovedProviders')!.outputs,
        options.warmStorageView.getApprovedProviders(args)
      )
    }
    case 'getAllDataSetMetadata': {
      if (!options.warmStorageView?.getAllDataSetMetadata) {
        throw new Error('Warm Storage View: getAllDataSetMetadata is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'getAllDataSetMetadata')!.outputs,
        options.warmStorageView.getAllDataSetMetadata(args)
      )
    }
    case 'getDataSetMetadata': {
      if (!options.warmStorageView?.getDataSetMetadata) {
        throw new Error('Warm Storage View: getDataSetMetadata is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'getDataSetMetadata')!.outputs,
        options.warmStorageView.getDataSetMetadata(args)
      )
    }
    case 'getAllPieceMetadata': {
      if (!options.warmStorageView?.getAllPieceMetadata) {
        throw new Error('Warm Storage View: getAllPieceMetadata is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'getAllPieceMetadata')!.outputs,
        options.warmStorageView.getAllPieceMetadata(args)
      )
    }
    case 'getPieceMetadata': {
      if (!options.warmStorageView?.getPieceMetadata) {
        throw new Error('Warm Storage View: getPieceMetadata is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'getPieceMetadata')!.outputs,
        options.warmStorageView.getPieceMetadata(args)
      )
    }
    case 'clientNonces': {
      if (!options.warmStorageView?.clientNonces) {
        throw new Error('Warm Storage View: clientNonces is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'clientNonces')!.outputs,
        options.warmStorageView.clientNonces(args)
      )
    }
    case 'getPDPConfig': {
      if (!options.warmStorageView?.getPDPConfig) {
        throw new Error('Warm Storage View: getPDPConfig is not defined')
      }
      return encodeAbiParameters(
        Abis.fwssView.find((abi) => abi.type === 'function' && abi.name === 'getPDPConfig')!.outputs,
        options.warmStorageView.getPDPConfig(args)
      )
    }

    default: {
      throw new Error(`Warm Storage View: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
