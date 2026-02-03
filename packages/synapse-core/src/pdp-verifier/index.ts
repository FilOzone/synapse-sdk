import {
  type Account,
  type Address,
  type Chain,
  type Client,
  type GetContractErrorType,
  type Transport,
  getContract as viemGetContract,
} from 'viem'
import { asChain } from '../chains.ts'

export * from './data-set-live.ts'
export * from './get-active-piece-count.ts'
export * from './get-active-pieces.ts'
export * from './get-data-set-leaf-count.ts'
export * from './get-data-set-listener.ts'
export * from './get-data-set-storage-provider.ts'
export * from './get-next-piece-id.ts'
export * from './get-scheduled-removals.ts'

export namespace getContract {
  export type OptionsType = {
    /** The client to use to get the contract. */
    client: Client<Transport, Chain, Account>
    /** The address of the contract. If not provided, the default is the PDP Verifier contract address for the chain. */
    address?: Address
  }

  export type OutputType = ReturnType<typeof viemGetContract>

  export type ErrorType = asChain.ErrorType | GetContractErrorType
}

/**
 * Get the PDP Verifier contract
 *
 * @example
 * ```ts
 * import { getContract } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const contract = getContract({ client })
 * const dataSetId = 1n
 * const isLive = await contract.read.dataSetLive([dataSetId])
 * ```
 *
 * @param options - {@link getContract.OptionsType}
 * @returns [Contract](https://viem.sh/docs/contract/getContract) {@link getContract.OutputType}
 * @throws Errors {@link getContract.ErrorType}
 */
export function getContract(options: getContract.OptionsType): getContract.OutputType {
  const chain = asChain(options.client.chain)
  return viemGetContract({
    address: options.address ?? chain.contracts.pdp.address,
    abi: chain.contracts.pdp.abi,
    client: options.client,
  })
}
