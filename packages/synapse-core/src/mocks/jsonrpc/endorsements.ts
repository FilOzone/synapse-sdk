import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import * as Abis from '../../abis/index.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type getProviderIds = ExtractAbiFunction<typeof Abis.providerIdSet, 'getProviderIds'>

export interface EndorsementsOptions {
  getProviderIds?: (args: AbiToType<getProviderIds['inputs']>) => AbiToType<getProviderIds['outputs']>
}

export function endorsementsCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: Abis.providerIdSet,
    data: data as Hex,
  })

  if (options.debug) {
    console.debug('Endorsements: calling function', functionName, 'with args', args)
  }

  switch (functionName) {
    case 'getProviderIds': {
      if (!options.endorsements?.getProviderIds) {
        throw new Error('Endorsements: getProviderIds is not defined')
      }
      return encodeAbiParameters(
        Abis.providerIdSet.find((abi) => abi.type === 'function' && abi.name === 'getProviderIds')!.outputs,
        options.endorsements.getProviderIds(args)
      )
    }

    default: {
      throw new Error(`Endorsements: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
