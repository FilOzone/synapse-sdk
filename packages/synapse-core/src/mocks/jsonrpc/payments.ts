/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import * as Abis from '../../abis/index.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type accounts = ExtractAbiFunction<typeof Abis.payments, 'accounts'>
export type deposit = ExtractAbiFunction<typeof Abis.payments, 'deposit'>
export type operatorApprovals = ExtractAbiFunction<typeof Abis.payments, 'operatorApprovals'>
export type setOperatorApproval = ExtractAbiFunction<typeof Abis.payments, 'setOperatorApproval'>
export type getRail = ExtractAbiFunction<typeof Abis.payments, 'getRail'>
export type getRailsForPayerAndToken = ExtractAbiFunction<typeof Abis.payments, 'getRailsForPayerAndToken'>
export type getRailsForPayeeAndToken = ExtractAbiFunction<typeof Abis.payments, 'getRailsForPayeeAndToken'>
export type settleRail = ExtractAbiFunction<typeof Abis.payments, 'settleRail'>
export type settleTerminatedRailWithoutValidation = ExtractAbiFunction<
  typeof Abis.payments,
  'settleTerminatedRailWithoutValidation'
>
export type depositWithPermit = ExtractAbiFunction<typeof Abis.payments, 'depositWithPermit'>
export type depositWithPermitAndApproveOperator = ExtractAbiFunction<
  typeof Abis.payments,
  'depositWithPermitAndApproveOperator'
>
export type withdraw = ExtractAbiFunction<typeof Abis.payments, 'withdraw'>
export type withdrawTo = ExtractAbiFunction<typeof Abis.payments, 'withdrawTo'>

export interface PaymentsOptions {
  accounts?: (args: AbiToType<accounts['inputs']>) => AbiToType<accounts['outputs']>
  deposit?: (args: AbiToType<deposit['inputs']>) => AbiToType<deposit['outputs']>
  operatorApprovals?: (args: AbiToType<operatorApprovals['inputs']>) => AbiToType<operatorApprovals['outputs']>
  setOperatorApproval?: (args: AbiToType<setOperatorApproval['inputs']>) => AbiToType<setOperatorApproval['outputs']>
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
  depositWithPermit?: (args: AbiToType<depositWithPermit['inputs']>) => AbiToType<depositWithPermit['outputs']>
  depositWithPermitAndApproveOperator?: (
    args: AbiToType<depositWithPermitAndApproveOperator['inputs']>
  ) => AbiToType<depositWithPermitAndApproveOperator['outputs']>
  withdraw?: (args: AbiToType<withdraw['inputs']>) => AbiToType<withdraw['outputs']>
  withdrawTo?: (args: AbiToType<withdrawTo['inputs']>) => AbiToType<withdrawTo['outputs']>
}

/**
 * Handle payments contract calls
 */
export function paymentsCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: Abis.payments,
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
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'operatorApprovals')!.outputs,
        options.payments.operatorApprovals(args)
      )
    }

    case 'setOperatorApproval': {
      if (!options.payments?.setOperatorApproval) {
        throw new Error('Payments: setOperatorApproval is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'setOperatorApproval')!.outputs,
        options.payments.setOperatorApproval(args)
      )
    }

    case 'accounts': {
      if (!options.payments?.accounts) {
        throw new Error('Payments: accounts is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'accounts')!.outputs,
        options.payments.accounts(args)
      )
    }

    case 'deposit': {
      if (!options.payments?.deposit) {
        throw new Error('Payments: deposit is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'deposit')!.outputs,
        options.payments.deposit(args)
      )
    }

    case 'depositWithPermit': {
      if (!options.payments?.depositWithPermit) {
        throw new Error('Payments: depositWithPermit is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'depositWithPermit')!.outputs,
        options.payments.depositWithPermit(args)
      )
    }

    case 'depositWithPermitAndApproveOperator': {
      if (!options.payments?.depositWithPermitAndApproveOperator) {
        throw new Error('Payments: depositWithPermitAndApproveOperator is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'depositWithPermitAndApproveOperator')!
          .outputs,
        options.payments.depositWithPermitAndApproveOperator(args)
      )
    }

    case 'getRail': {
      if (!options.payments?.getRail) {
        throw new Error('Payments: getRail is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'getRail')!.outputs,
        options.payments.getRail(args)
      )
    }

    case 'getRailsForPayerAndToken': {
      if (!options.payments?.getRailsForPayerAndToken) {
        throw new Error('Payments: getRailsForPayerAndToken is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'getRailsForPayerAndToken')!.outputs,
        options.payments.getRailsForPayerAndToken(args)
      )
    }

    case 'getRailsForPayeeAndToken': {
      if (!options.payments?.getRailsForPayeeAndToken) {
        throw new Error('Payments: getRailsForPayeeAndToken is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'getRailsForPayeeAndToken')!.outputs,
        options.payments.getRailsForPayeeAndToken(args)
      )
    }

    case 'settleRail': {
      if (!options.payments?.settleRail) {
        throw new Error('Payments: settleRail is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'settleRail')!.outputs,
        options.payments.settleRail(args)
      )
    }

    case 'settleTerminatedRailWithoutValidation': {
      if (!options.payments?.settleTerminatedRailWithoutValidation) {
        throw new Error('Payments: settleTerminatedRailWithoutValidation is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'settleTerminatedRailWithoutValidation')!
          .outputs,
        options.payments.settleTerminatedRailWithoutValidation(args)
      )
    }

    case 'withdraw': {
      if (!options.payments?.withdraw) {
        throw new Error('Payments: withdraw is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'withdraw')!.outputs,
        options.payments.withdraw(args)
      )
    }

    case 'withdrawTo': {
      if (!options.payments?.withdrawTo) {
        throw new Error('Payments: withdrawTo is not defined')
      }
      return encodeAbiParameters(
        Abis.payments.find((abi) => abi.type === 'function' && abi.name === 'withdrawTo')!.outputs,
        options.payments.withdrawTo(args)
      )
    }

    default: {
      throw new Error(`Payments: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
