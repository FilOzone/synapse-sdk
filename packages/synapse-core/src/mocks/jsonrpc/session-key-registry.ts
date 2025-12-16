/** biome-ignore-all lint/style/noNonNullAssertion: testing */

import type { ExtractAbiFunction } from 'abitype'
import { decodeFunctionData, encodeAbiParameters, type Hex } from 'viem'
import * as Abis from '../../abis/index.ts'
import type { AbiToType, JSONRPCOptions } from './types.ts'

export type authorizationExpiry = ExtractAbiFunction<typeof Abis.sessionKeyRegistry, 'authorizationExpiry'>

export interface SessionKeyRegistryOptions {
  authorizationExpiry?: (args: AbiToType<authorizationExpiry['inputs']>) => AbiToType<authorizationExpiry['outputs']>
}

export function sessionKeyRegistryCallHandler(data: Hex, options: JSONRPCOptions): Hex {
  const { functionName, args } = decodeFunctionData({
    abi: Abis.sessionKeyRegistry,
    data: data as Hex,
  })

  if (options.debug) {
    console.debug('Session Key Registry: calling function', functionName, 'with args', args)
  }

  switch (functionName) {
    case 'authorizationExpiry': {
      if (!options.sessionKeyRegistry?.authorizationExpiry) {
        throw new Error('Service Provider Registry: authorizationExpiry is not defined')
      }
      return encodeAbiParameters(
        Abis.sessionKeyRegistry.find((abi) => abi.type === 'function' && abi.name === 'authorizationExpiry')!.outputs,
        options.sessionKeyRegistry.authorizationExpiry(args)
      )
    }
    default: {
      throw new Error(`SessionKeyRegistry: unknown function: ${functionName} with args: ${args}`)
    }
  }
}
