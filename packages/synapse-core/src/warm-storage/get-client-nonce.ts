import type { Simplify } from 'type-fest'
import type {
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  ReadContractErrorType,
  Transport,
} from 'viem'
import { readContract } from 'viem/actions'
import type { fwssView as storageViewAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getClientNonce {
  export type OptionsType = {
    /** The payer the nonce was signed for. */
    payer: Address
    /** The nonce: a client data set ID for create data set, or the add pieces nonce. */
    nonce: bigint
    /** Warm storage view contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<typeof storageViewAbi, 'pure' | 'view', 'clientNonces'>

  /**
   * `0n` when the nonce is unused. Otherwise the data set ID for a create data set nonce, or
   * `(nextPieceId << 128) | dataSetId` for an add pieces nonce.
   */
  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Read the raw value FWSS stores for a used replay-protection nonce.
 *
 * Prefer {@link getAddPiecesResult}, {@link getCreateDataSetResult} or {@link getCreateDataSetAndAddPiecesResult},
 * which decode it.
 *
 * @param client - The client to use to read the nonce.
 * @param options - {@link getClientNonce.OptionsType}
 * @returns The stored value {@link getClientNonce.OutputType}
 * @throws Errors {@link getClientNonce.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientNonce } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const value = await getClientNonce(client, {
 *   payer: '0x0000000000000000000000000000000000000000',
 *   nonce: 1n,
 * })
 *
 * console.log(value === 0n ? 'unused' : 'used')
 * ```
 */
export async function getClientNonce(
  client: Client<Transport, Chain>,
  options: getClientNonce.OptionsType
): Promise<getClientNonce.OutputType> {
  const data = await readContract(
    client,
    getClientNonceCall({
      chain: client.chain,
      payer: options.payer,
      nonce: options.nonce,
      contractAddress: options.contractAddress,
    })
  )
  return data as getClientNonce.OutputType
}

export namespace getClientNonceCall {
  export type OptionsType = Simplify<getClientNonce.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'clientNonces'>
}

/**
 * Create a call to the {@link getClientNonce} function for use with the Viem multicall, readContract, or simulateContract functions.
 *
 * @param options - {@link getClientNonceCall.OptionsType}
 * @returns The call to the clientNonces function {@link getClientNonceCall.OutputType}
 * @throws Errors {@link getClientNonceCall.ErrorType}
 */
export function getClientNonceCall(options: getClientNonceCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'clientNonces',
    args: [options.payer, options.nonce],
  } satisfies getClientNonceCall.OutputType
}
