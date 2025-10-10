import type { Address } from 'viem'

// Define the type for the contract object wagmi uses
export type ContractConfig = {
  name: string
  address: Address
  chainId: number
  isProxy?: boolean
}

interface FilfoxProxyResponse {
  proxyImpl: string | null
  abi: string | null
}

// Unified ABI fetcher: routes to proxy or direct ABI fetch logic based on contract type.
// If the contract is a proxy (isProxy=true), fetches the implementation ABI; otherwise, fetches the contract's own ABI.
export async function fetchContractAbi(contract: ContractConfig): Promise<{ body: string }> {
  if (contract.isProxy) {
    return fetchProxyAbi(contract)
  } else {
    return fetchDirectAbi(contract)
  }
}

/**
 * Fetches the ABI for contract's implementation from Filfox.
 * @param contract The contract configuration from wagmi.
 * @returns A promise resolving to the ABI content for wagmi.
 */
async function fetchDirectAbi(contract: ContractConfig): Promise<{ body: string }> {
  return fetchAbiFromAddress(contract.address, contract.name, contract.chainId)
}

/**
 * Fetches the ABI for a proxy contract's implementation from Filfox.
 * @param contract The contract configuration from wagmi.
 * @returns A promise resolving to the ABI content for wagmi.
 */
async function fetchProxyAbi(contract: ContractConfig): Promise<{ body: string }> {
  // 1. Fetch the implementation address from the proxy contract.
  const proxyUrl = `https://filfox.info/api/v1/address/${contract.address}/contract`
  const proxyResponse = await fetch(proxyUrl, {
    headers: { Accept: 'application/json' },
  })
  if (!proxyResponse.ok) {
    throw new Error(`Failed to fetch data for proxy contract. Status: ${proxyResponse.status}`)
  }
  const proxyData = (await proxyResponse.json()) as FilfoxProxyResponse
  const implementationAddress = proxyData?.proxyImpl
  if (!implementationAddress || implementationAddress === 'null') {
    throw new Error(`Could not find implementation address ('proxyImpl') in API response for ${contract.name}.`)
  }

  // 2. Fetch the ABI from the implementation contract using the helper
  return fetchAbiFromAddress(implementationAddress as Address, contract.name, contract.chainId)
}

// Internal helper to fetch and parse ABI from Filfox for a given address
async function fetchAbiFromAddress(address: Address, name: string, chainId: number): Promise<{ body: string }> {
  try {
    const url = `https://filfox.info/api/v1/address/${address}/contract`
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch data for contract. Status: ${response.status}`)
    }
    const data = (await response.json()) as FilfoxProxyResponse
    const abiString = data?.abi
    if (typeof abiString !== 'string' || abiString.length === 0) {
      throw new Error(`Failed to parse ABI. The '.abi' field may be missing, null, or not a valid string.`)
    }
    const abi = JSON.parse(abiString)
    console.log(`Successfully fetched ABI for ${name}.`)
    return {
      body: JSON.stringify(abi, null, 2),
    }
  } catch (error) {
    console.error(`Failed to fetch ABI for ${name} on chain ${chainId}:`, error)
    throw error
  }
}
