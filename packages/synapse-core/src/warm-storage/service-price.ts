import type { Address, Chain, Client, Transport } from 'viem'
import { readContract } from 'viem/actions'
import { getChain } from '../chains.ts'

export type ServicePriceResult = {
  pricePerTiBPerMonthNoCDN: bigint
  pricePerTiBCdnEgress: bigint
  pricePerTiBCacheMissEgress: bigint
  tokenAddress: Address
  epochsPerMonth: bigint
  minimumPricePerMonth: bigint
}

/**
 * Get the service price for the warm storage.
 *
 * @param client - The client to use.
 * @returns The service price.
 */
export async function servicePrice(client: Client<Transport, Chain>): Promise<ServicePriceResult> {
  const chain = getChain(client.chain.id)
  const result = await readContract(client, {
    address: chain.contracts.storage.address,
    abi: chain.contracts.storage.abi,
    functionName: 'getServicePrice',
  })
  return result
}
