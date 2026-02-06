import type { Address, Chain, Client, MulticallErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import { asChain } from '../chains.ts'

export namespace readAddresses {
  export type OptionsType = {
    /** Warm storage contract address. If not provided, the default is the storage contract address for the chain. */
    contractAddress?: Address
  }
  export type OutputType = {
    payments: Address
    warmStorageView: Address
    pdpVerifier: Address
    serviceProviderRegistry: Address
    sessionKeyRegistry: Address
    usdfcToken: Address
    filBeamBeneficiary: Address
  }
  export type ErrorType = asChain.ErrorType | MulticallErrorType
}

/**
 * Read FOC addresses from the Warm Storage contract
 *
 * @param client - The client to use to read the addresses.
 * @param options - {@link readAddresses.OptionsType}
 * @returns The addresses {@link readAddresses.OutputType}
 * @throws Errors {@link readAddresses.ErrorType}
 */
export async function readAddresses(
  client: Client<Transport, Chain>,
  options: readAddresses.OptionsType = {}
): Promise<readAddresses.OutputType> {
  const chain = asChain(client.chain)
  const contractAddress = options.contractAddress ?? chain.contracts.fwss.address
  const addresses = await multicall(client, {
    allowFailure: false,
    contracts: [
      {
        address: contractAddress,
        abi: chain.contracts.fwss.abi,
        functionName: 'paymentsContractAddress',
      },
      {
        address: contractAddress,
        abi: chain.contracts.fwss.abi,
        functionName: 'viewContractAddress',
      },
      {
        address: contractAddress,
        abi: chain.contracts.fwss.abi,
        functionName: 'pdpVerifierAddress',
      },

      {
        address: contractAddress,
        abi: chain.contracts.fwss.abi,
        functionName: 'serviceProviderRegistry',
      },

      {
        address: contractAddress,
        abi: chain.contracts.fwss.abi,
        functionName: 'sessionKeyRegistry',
      },
      {
        address: contractAddress,
        abi: chain.contracts.fwss.abi,
        functionName: 'usdfcTokenAddress',
      },

      {
        address: contractAddress,
        abi: chain.contracts.fwss.abi,
        functionName: 'filBeamBeneficiaryAddress',
      },
    ],
  })

  return {
    payments: addresses[0],
    warmStorageView: addresses[1],
    pdpVerifier: addresses[2],
    serviceProviderRegistry: addresses[3],
    sessionKeyRegistry: addresses[4],
    usdfcToken: addresses[5],
    filBeamBeneficiary: addresses[6],
  }
}
