import type { Simplify } from 'type-fest'
import type {
  Account,
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  Hash,
  SimulateContractErrorType,
  Transport,
  WaitForTransactionReceiptErrorType,
  WriteContractErrorType,
} from 'viem'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import type { sessionKeyRegistry as sessionKeyRegistryAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'
import { extractLoginEvent } from './login.ts'
import { DefaultFwssPermissions, type Permission } from './permissions.ts'

export namespace revoke {
  export type OptionsType = {
    /** Session key address. */
    address: Address
    /** The permissions to revoke from the session key. Defaults to all permissions. */
    permissions?: Permission[]
    /** The origin of the revoke operation. Defaults to 'synapse'. */
    origin?: string
    /** Session key registry contract address. If not provided, defaults to the chain contract address. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = asChain.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Revoke session key permissions.
 *
 * @param client - The client to use to revoke session key permissions.
 * @param options - {@link revoke.OptionsType}
 * @returns The transaction hash {@link revoke.OutputType}
 * @throws Errors {@link revoke.ErrorType}
 */
export async function revoke(
  client: Client<Transport, Chain, Account>,
  options: revoke.OptionsType
): Promise<revoke.OutputType> {
  const { request } = await simulateContract(
    client,
    revokeCall({
      chain: client.chain,
      address: options.address,
      permissions: options.permissions,
      origin: options.origin,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace revokeSync {
  export type OptionsType = Simplify<revoke.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractRevokeEvent>
  export type ErrorType =
    | revokeCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Revoke session key permissions and wait for confirmation.
 *
 * @param client - The client to use to revoke session key permissions.
 * @param options - {@link revokeSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link revokeSync.OutputType}
 * @throws Errors {@link revokeSync.ErrorType}
 */
export async function revokeSync(
  client: Client<Transport, Chain, Account>,
  options: revokeSync.OptionsType
): Promise<revokeSync.OutputType> {
  const hash = await revoke(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractRevokeEvent(receipt.logs)

  return { receipt, event }
}

export namespace revokeCall {
  export type OptionsType = Simplify<revoke.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof sessionKeyRegistryAbi, 'nonpayable', 'revoke'>
}

/**
 * Create a call to the revoke function.
 *
 * @param options - {@link revokeCall.OptionsType}
 * @returns The call object {@link revokeCall.OutputType}
 * @throws Errors {@link revokeCall.ErrorType}
 */
export function revokeCall(options: revokeCall.OptionsType) {
  const chain = asChain(options.chain)
  const permissions = options.permissions ?? DefaultFwssPermissions
  return {
    abi: chain.contracts.sessionKeyRegistry.abi,
    address: options.contractAddress ?? chain.contracts.sessionKeyRegistry.address,
    functionName: 'revoke',
    args: [options.address, Array.from(new Set(permissions)), options.origin ?? 'synapse'],
  } satisfies revokeCall.OutputType
}

/**
 * Extracts the AuthorizationsUpdated event from transaction logs.
 *
 * @param logs - The transaction logs.
 * @returns The AuthorizationsUpdated event.
 */
export const extractRevokeEvent = extractLoginEvent
