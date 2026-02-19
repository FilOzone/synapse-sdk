import type { Simplify } from 'type-fest'
import {
  type Address,
  type Chain,
  type Client,
  ContractFunctionExecutionError,
  type ContractFunctionParameters,
  type ContractFunctionReturnType,
  type MulticallErrorType,
  type ReadContractErrorType,
  type Transport,
} from 'viem'
import { multicall, readContract } from 'viem/actions'
import type { sessionKeyRegistry as sessionKeyRegistryAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'
import {
  ALL_PERMISSIONS,
  EMPTY_EXPIRATIONS,
  SESSION_KEY_PERMISSIONS,
  type SessionKeyPermissions,
} from './permissions.ts'

export namespace authorizationExpiry {
  export type OptionsType = {
    /** The address of the user account. */
    address: Address
    /** The address of the session key. */
    sessionKeyAddress: Address
    /** The session key permission. */
    permission: SessionKeyPermissions
    /** Session key registry contract address. If not provided, the default is the session key registry contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof sessionKeyRegistryAbi,
    'pure' | 'view',
    'authorizationExpiry'
  >

  /** The expiry timestamp as a bigint (Unix timestamp in seconds). */
  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the authorization expiry timestamp for a session key permission.
 *
 * Returns the Unix timestamp (in seconds) when the authorization for the given
 * address, sessionKeyAddress, and permission combination expires. Returns 0 if no authorization exists.
 *
 * @param client - The client to use to get the authorization expiry.
 * @param options - {@link authorizationExpiry.OptionsType}
 * @returns The expiry timestamp as a bigint (Unix timestamp in seconds) {@link authorizationExpiry.OutputType}
 * @throws Errors {@link authorizationExpiry.ErrorType}
 *
 * @example
 * ```ts
 * import { authorizationExpiry } from '@filoz/synapse-core/session-key'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const expiry = await authorizationExpiry(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 *   sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
 *   permission: 'CreateDataSet',
 * })
 *
 * console.log('Authorization expires at:', expiry)
 * ```
 */
export async function authorizationExpiry(
  client: Client<Transport, Chain>,
  options: authorizationExpiry.OptionsType
): Promise<authorizationExpiry.OutputType> {
  const data = await readContract(
    client,
    authorizationExpiryCall({
      chain: client.chain,
      address: options.address,
      sessionKeyAddress: options.sessionKeyAddress,
      permission: options.permission,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace authorizationExpiryCall {
  export type OptionsType = Simplify<authorizationExpiry.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof sessionKeyRegistryAbi,
    'pure' | 'view',
    'authorizationExpiry'
  >
}

/**
 * Create a call to the authorizationExpiry function
 *
 * This function is used to create a call to the authorizationExpiry function for use with the multicall or readContract function.
 *
 * @param options - {@link authorizationExpiryCall.OptionsType}
 * @returns The call to the authorizationExpiry function {@link authorizationExpiryCall.OutputType}
 * @throws Errors {@link authorizationExpiryCall.ErrorType}
 *
 * @example
 * ```ts
 * import { authorizationExpiryCall } from '@filoz/synapse-core/session-key'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const results = await multicall(client, {
 *   contracts: [
 *     authorizationExpiryCall({
 *       chain: calibration,
 *       address: '0x1234567890123456789012345678901234567890',
 *       sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
 *       permission: 'CreateDataSet',
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function authorizationExpiryCall(options: authorizationExpiryCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.sessionKeyRegistry.abi,
    address: options.contractAddress ?? chain.contracts.sessionKeyRegistry.address,
    functionName: 'authorizationExpiry',
    args: [options.address, options.sessionKeyAddress, SESSION_KEY_PERMISSIONS[options.permission]],
  } satisfies authorizationExpiryCall.OutputType
}

export namespace isExpired {
  export type OptionsType = Simplify<authorizationExpiry.OptionsType>
  export type ErrorType = authorizationExpiry.ErrorType
  export type OutputType = boolean
}

/**
 * Check if the session key is expired.
 *
 * @param client - The client to use.
 * @param options - The options to use.
 * @returns Whether the session key is expired.
 * @throws - {@link isExpired.ErrorType} if the read contract fails.
 */
export async function isExpired(
  client: Client<Transport, Chain>,
  options: isExpired.OptionsType
): Promise<isExpired.OutputType> {
  const expiry = await authorizationExpiry(client, options)

  return expiry < BigInt(Math.floor(Date.now() / 1000))
}

export namespace getExpirations {
  export type OptionsType = Simplify<Omit<authorizationExpiry.OptionsType, 'permission'>>
  export type ErrorType = authorizationExpiry.ErrorType | MulticallErrorType
  export type OutputType = Record<SessionKeyPermissions, bigint>
}

/**
 * Get the expirations for all permissions.
 *
 * @param client - The client to use.
 * @param options - {@link getExpirations.OptionsType}
 * @returns The expirations as a record of {@link SessionKeyPermissions} to {@link bigint} {@link getExpirations.OutputType}
 * @throws Errors {@link getExpirations.ErrorType}
 *
 * @example
 * ```ts
 * import { getExpirations } from '@filoz/synapse-core/session-key'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const expirations = await getExpirations(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 *   sessionKeyAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
 * })
 *
 * console.log(expirations)
 */
export async function getExpirations(client: Client<Transport, Chain>, options: getExpirations.OptionsType) {
  const expirations: Record<SessionKeyPermissions, bigint> = EMPTY_EXPIRATIONS

  try {
    const result = await multicall(client, {
      allowFailure: false,
      contracts: ALL_PERMISSIONS.map((permission) =>
        authorizationExpiryCall({
          chain: client.chain,
          address: options.address,
          sessionKeyAddress: options.sessionKeyAddress,
          permission,
        })
      ),
    })

    for (let i = 0; i < ALL_PERMISSIONS.length; i++) {
      expirations[ALL_PERMISSIONS[i]] = result[i]
    }
  } catch (e) {
    if (!(e instanceof ContractFunctionExecutionError && e.details.includes('actor not found'))) {
      throw e
    }
  }

  return expirations
}
