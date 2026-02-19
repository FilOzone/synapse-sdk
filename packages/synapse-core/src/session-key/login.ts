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

export namespace login {
  export type OptionsType = {
    /** Session key address. */
    address: Address
    /** The permissions to authorize for the session key. Defaults to all permissions. */
    permissions?: SessionKeyPermissions[]
    /** The expiry time as Unix timestamp (seconds). Defaults to now + 1 hour. */
    expiresAt?: bigint
    /** The origin of the session key authorization. Defaults to 'synapse'. */
    origin?: string
    /** Session key registry contract address. If not provided, defaults to the chain contract address. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = asChain.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Authorize a session key with permissions until expiry.
 *
 * @param client - The client to use to authorize the session key.
 * @param options - {@link login.OptionsType}
 * @returns The transaction hash {@link login.OutputType}
 * @throws Errors {@link login.ErrorType}
 */
export async function login(
  client: Client<Transport, Chain, Account>,
  options: login.OptionsType
): Promise<login.OutputType> {
  const { request } = await simulateContract(
    client,
    loginCall({
      chain: client.chain,
      address: options.address,
      permissions: options.permissions,
      expiresAt: options.expiresAt,
      origin: options.origin,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace loginSync {
  export type OptionsType = Simplify<login.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractLoginEvent>
  export type ErrorType =
    | loginCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Authorize a session key and wait for confirmation.
 *
 * @param client - The client to use to authorize the session key.
 * @param options - {@link loginSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link loginSync.OutputType}
 * @throws Errors {@link loginSync.ErrorType}
 */
export async function loginSync(
  client: Client<Transport, Chain, Account>,
  options: loginSync.OptionsType
): Promise<loginSync.OutputType> {
  const hash = await login(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractLoginEvent(receipt.logs)

  return { receipt, event }
}

export namespace loginCall {
  export type OptionsType = Simplify<login.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof sessionKeyRegistryAbi, 'nonpayable', 'login'>
}

/**
 * Create a call to the login function.
 *
 * @param options - {@link loginCall.OptionsType}
 * @returns The call object {@link loginCall.OutputType}
 * @throws Errors {@link loginCall.ErrorType}
 */
export function loginCall(options: loginCall.OptionsType) {
  const chain = asChain(options.chain)
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const permissions = options.permissions ?? ALL_PERMISSIONS
  return {
    abi: chain.contracts.sessionKeyRegistry.abi,
    address: options.contractAddress ?? chain.contracts.sessionKeyRegistry.address,
    functionName: 'login',
    args: [
      options.address,
      options.expiresAt ?? expiresAt,
      [...new Set(permissions)].map((permission) => SESSION_KEY_PERMISSIONS[permission]),
      options.origin ?? 'synapse',
    ],
  } satisfies loginCall.OutputType
}

/**
 * Extracts the AuthorizationsUpdated event from transaction logs.
 *
 * @param logs - The transaction logs.
 * @returns The AuthorizationsUpdated event.
 */
export function extractLoginEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.sessionKeyRegistry,
    logs,
    eventName: 'AuthorizationsUpdated',
    strict: true,
  })
  if (!log) throw new Error('`AuthorizationsUpdated` event not found.')
  return log
}
