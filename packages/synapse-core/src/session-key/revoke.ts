import type { Simplify } from 'type-fest'
import type {
  Account,
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  Hash,
  Log,
  SimulateContractErrorType,
  Transport,
  WaitForTransactionReceiptErrorType,
  WriteContractErrorType,
} from 'viem'
import { parseEventLogs } from 'viem'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import type { sessionKeyRegistry as sessionKeyRegistryAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'
import { ALL_PERMISSIONS, SESSION_KEY_PERMISSIONS, type SessionKeyPermissions } from './permissions.ts'

export namespace revoke {
  export type OptionsType = {
    /** Session key address. */
    address: Address
    /** The permissions to revoke from the session key. Defaults to all permissions. */
    permissions?: SessionKeyPermissions[]
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
  const permissions = options.permissions ?? ALL_PERMISSIONS
  return {
    abi: chain.contracts.sessionKeyRegistry.abi,
    address: options.contractAddress ?? chain.contracts.sessionKeyRegistry.address,
    functionName: 'revoke',
    args: [
      options.address,
      [...new Set(permissions)].map((permission) => SESSION_KEY_PERMISSIONS[permission]),
      options.origin ?? 'synapse',
    ],
  } satisfies revokeCall.OutputType
}

/**
 * Extracts the AuthorizationsUpdated event from transaction logs.
 *
 * @param logs - The transaction logs.
 * @returns The AuthorizationsUpdated event.
 */
export function extractRevokeEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.sessionKeyRegistry,
    logs,
    eventName: 'AuthorizationsUpdated',
    strict: true,
  })
  if (!log) throw new Error('`AuthorizationsUpdated` event not found.')
  return log
}
