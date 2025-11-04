/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type accounts = ExtractAbiFunction<typeof CONTRACT_ABIS.PAYMENTS, 'accounts'>
export type operatorApprovals = ExtractAbiFunction<typeof CONTRACT_ABIS.PAYMENTS, 'operatorApprovals'>
export type getRail = ExtractAbiFunction<typeof CONTRACT_ABIS.PAYMENTS, 'getRail'>
export type getRailsForPayerAndToken = ExtractAbiFunction<typeof CONTRACT_ABIS.PAYMENTS, 'getRailsForPayerAndToken'>
export type getRailsForPayeeAndToken = ExtractAbiFunction<typeof CONTRACT_ABIS.PAYMENTS, 'getRailsForPayeeAndToken'>
export type settleRail = ExtractAbiFunction<typeof CONTRACT_ABIS.PAYMENTS, 'settleRail'>
export type settleTerminatedRailWithoutValidation = ExtractAbiFunction<
  typeof CONTRACT_ABIS.PAYMENTS,
  'settleTerminatedRailWithoutValidation'
>

export interface PaymentsOptions {
  accounts?: (args: AbiToType<accounts['inputs']>) => AbiToType<accounts['outputs']>
  operatorApprovals?: (args: AbiToType<operatorApprovals['inputs']>) => AbiToType<operatorApprovals['outputs']>
  getRail?: (args: AbiToType<getRail['inputs']>) => AbiToType<getRail['outputs']>
  getRailsForPayerAndToken?: (
    args: AbiToType<getRailsForPayerAndToken['inputs']>
  ) => AbiToType<getRailsForPayerAndToken['outputs']>
  getRailsForPayeeAndToken?: (
    args: AbiToType<getRailsForPayeeAndToken['inputs']>
  ) => AbiToType<getRailsForPayeeAndToken['outputs']>
  settleRail?: (args: AbiToType<settleRail['inputs']>) => AbiToType<settleRail['outputs']>
  settleTerminatedRailWithoutValidation?: (
    args: AbiToType<settleTerminatedRailWithoutValidation['inputs']>
  ) => AbiToType<settleTerminatedRailWithoutValidation['outputs']>
  NETWORK_FEE?: () => bigint
}

/**
 * Handle payments contract calls
 */
export function paymentsCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  // Check for NETWORK_FEE constant (function selector: 0x9be5c024) - constants are accessed as functions but may not be in ABI
  if (data.startsWith('0x9be5c024')) {
    if (!options.payments?.NETWORK_FEE) {
      throw new Error('Payments: NETWORK_FEE is not defined')
    }
    const fee = options.payments.NETWORK_FEE()
    return encodeAbiParameters([{ type: 'uint256' }], [fee])
  }

  const { functionName, args } = decodeFunctionData({
    abi: CONTRACT_ABIS.PAYMENTS,
    data: data as Hex,
  })

  if (options.debug) {
    console.debug('Payments: calling function', functionName, 'with args', args)
  }

  switch (functionName) {
    case 'operatorApprovals': {
      if (!options.payments?.operatorApprovals) {
        throw new Error('Payments: operatorApprovals is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PAYMENTS.find((abi) => abi.type === 'function' && abi.name === 'operatorApprovals')!.outputs,
        options.payments.operatorApprovals(args)
      )
    }

    case 'accounts': {
      if (!options.payments?.accounts) {
        throw new Error('Payments: accounts is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PAYMENTS.find((abi) => abi.type === 'function' && abi.name === 'accounts')!.outputs,
        options.payments.accounts(args)
      )
    }

    case 'getRail': {
      if (!options.payments?.getRail) {
        throw new Error('Payments: getRail is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PAYMENTS.find((abi) => abi.type === 'function' && abi.name === 'getRail')!.outputs,
        options.payments.getRail(args)
      )
    }

    case 'getRailsForPayerAndToken': {
      if (!options.payments?.getRailsForPayerAndToken) {
        throw new Error('Payments: getRailsForPayerAndToken is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PAYMENTS.find((abi) => abi.type === 'function' && abi.name === 'getRailsForPayerAndToken')!
          .outputs,
        options.payments.getRailsForPayerAndToken(args)
      )
    }

    case 'getRailsForPayeeAndToken': {
      if (!options.payments?.getRailsForPayeeAndToken) {
        throw new Error('Payments: getRailsForPayeeAndToken is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PAYMENTS.find((abi) => abi.type === 'function' && abi.name === 'getRailsForPayeeAndToken')!
          .outputs,
        options.payments.getRailsForPayeeAndToken(args)
      )
    }

    case 'settleRail': {
      if (!options.payments?.settleRail) {
        throw new Error('Payments: settleRail is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PAYMENTS.find((abi) => abi.type === 'function' && abi.name === 'settleRail')!.outputs,
        options.payments.settleRail(args)
      )
    }

    case 'settleTerminatedRailWithoutValidation': {
      if (!options.payments?.settleTerminatedRailWithoutValidation) {
        throw new Error('Payments: settleTerminatedRailWithoutValidation is not defined')
      }
      return encodeAbiParameters(
        CONTRACT_ABIS.PAYMENTS.find(
          (abi) => abi.type === 'function' && abi.name === 'settleTerminatedRailWithoutValidation'
        )!.outputs,
        options.payments.settleTerminatedRailWithoutValidation(args)
      )
    }

    default: {
      throw new Error(`Payments: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
