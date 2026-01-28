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
        address: chain.contracts.fwss.address,
        abi: chain.contracts.fwss.abi,
        functionName: 'paymentsContractAddress',
      },
      {
        address: chain.contracts.fwss.address,
        abi: chain.contracts.fwss.abi,
        functionName: 'viewContractAddress',
      },
      {
        address: chain.contracts.fwss.address,
        abi: chain.contracts.fwss.abi,
        functionName: 'pdpVerifierAddress',
      },

      {
        address: chain.contracts.fwss.address,
        abi: chain.contracts.fwss.abi,
        functionName: 'serviceProviderRegistry',
      },

      {
        address: chain.contracts.fwss.address,
        abi: chain.contracts.fwss.abi,
        functionName: 'sessionKeyRegistry',
      },
      {
        address: chain.contracts.fwss.address,
        abi: chain.contracts.fwss.abi,
        functionName: 'usdfcTokenAddress',
      },

      {
        address: chain.contracts.fwss.address,
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
