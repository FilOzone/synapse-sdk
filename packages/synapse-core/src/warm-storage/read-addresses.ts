import type { Address, Chain, Client, Transport } from 'viem'
import { multicall } from 'viem/actions'
import { getChain } from '../chains.ts'

export type ReadAddressesResult = {
  payments: Address
  warmStorageView: Address
  pdpVerifier: Address
  serviceProviderRegistry: Address
  sessionKeyRegistry: Address
  usdfcToken: Address
  filBeamBeneficiary: Address
}

export async function readAddresses(client: Client<Transport, Chain>): Promise<ReadAddressesResult> {
  const chain = getChain(client.chain.id)
  const addresses = await multicall(client, {
    allowFailure: false,
    contracts: [
      {
        address: chain.contracts.storage.address,
        abi: chain.contracts.storage.abi,
        functionName: 'paymentsContractAddress',
      },
      {
        address: chain.contracts.storage.address,
        abi: chain.contracts.storage.abi,
        functionName: 'viewContractAddress',
      },
      {
        address: chain.contracts.storage.address,
        abi: chain.contracts.storage.abi,
        functionName: 'pdpVerifierAddress',
      },

      {
        address: chain.contracts.storage.address,
        abi: chain.contracts.storage.abi,
        functionName: 'serviceProviderRegistry',
      },

      {
        address: chain.contracts.storage.address,
        abi: chain.contracts.storage.abi,
        functionName: 'sessionKeyRegistry',
      },
      {
        address: chain.contracts.storage.address,
        abi: chain.contracts.storage.abi,
        functionName: 'usdfcTokenAddress',
      },

      {
        address: chain.contracts.storage.address,
        abi: chain.contracts.storage.abi,
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
