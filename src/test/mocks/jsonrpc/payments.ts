/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import { CONTRACT_ABIS } from '../../../utils/constants.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type operatorApprovals = ExtractAbiFunction<typeof CONTRACT_ABIS.PAYMENTS, 'operatorApprovals'>

export interface PaymentsOptions {
  operatorApprovals?: (args: AbiToType<operatorApprovals['inputs']>) => AbiToType<operatorApprovals['outputs']>
}

/**
 * Handle pdp verifier calls
 */
export function paymentsCallHandler(data: Hex, options: JSONRPCOptions): Hex {
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

    default: {
      throw new Error(`Payments: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
