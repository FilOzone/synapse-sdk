/** biome-ignore-all lint/style/noNonNullAssertion: testing */
import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import { ADDRESSES, type JSONRPCOptions } from './index.ts'

export type isProviderApprovedInput = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'isProviderApproved'>['inputs']
>

export type railToDataSetInput = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'railToDataSet'>['inputs']
>

export type getClientDataSetsInput = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getClientDataSets'>['inputs']
>
export type DataSetInfo = AbiParametersToPrimitiveTypes<
  ExtractAbiFunction<typeof CONTRACT_ABIS.WARM_STORAGE_VIEW, 'getClientDataSets'>['outputs']
>

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
    case 'pdpVerifierAddress':
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        [options.warmStorage?.pdpVerifierAddress ?? ADDRESSES.calibration.pdpVerifier]
      )
    case 'paymentsContractAddress':
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        [options.warmStorage?.paymentsContractAddress ?? ADDRESSES.calibration.payments]
      )
    case 'usdfcTokenAddress':
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        [options.warmStorage?.usdfcTokenAddress ?? ADDRESSES.calibration.usdfcToken]
      )
    case 'filCDNBeneficiaryAddress':
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        [options.warmStorage?.filCDNBeneficiaryAddress ?? ADDRESSES.calibration.filCDN]
      )
    case 'viewContractAddress':
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        [options.warmStorage?.viewContractAddress ?? ADDRESSES.calibration.viewContract]
      )
    case 'serviceProviderRegistry':
      return encodeAbiParameters(
        [{ name: '', internalType: 'address', type: 'address' }],
        [options.warmStorage?.serviceProviderRegistry ?? ADDRESSES.calibration.spRegistry]
      )
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
    case 'isProviderApproved':
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'isProviderApproved')!
          .outputs,
        [options.warmStorageView?.isProviderApproved?.(args as isProviderApprovedInput) ?? true]
      )
    case 'getClientDataSets': {
      const defaultClientDataSets: DataSetInfo = [
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
      ]
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'getClientDataSets')!
          .outputs,
        options.warmStorageView?.getClientDataSets?.(args as getClientDataSetsInput) ?? defaultClientDataSets
      )
    }

    case 'railToDataSet': {
      return encodeAbiParameters(
        CONTRACT_ABIS.WARM_STORAGE_VIEW.find((abi) => abi.type === 'function' && abi.name === 'railToDataSet')!.outputs,
        options.warmStorageView?.railToDataSet?.(args as railToDataSetInput) ?? [1n]
      )
    }

    default: {
      throw new Error(`Warm Storage View: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
