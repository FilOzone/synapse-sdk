import { getChain } from '@filoz/synapse-core/chains'
import { ethers } from 'ethers'
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  createClient,
  createWalletClient,
  custom,
  http,
  type Transport,
  webSocket,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export async function providerToClient(provider: ethers.Provider): Promise<Client<Transport, Chain>> {
  const network = await provider.getNetwork()
  const chainId = Number(network.chainId)
  const chain = getChain(chainId)

  let transport: Transport

  if (provider instanceof ethers.WebSocketProvider) {
    // @ts-expect-error
    const url = provider.websocket.url
    transport = webSocket(url)
  } else if (provider instanceof ethers.JsonRpcProvider) {
    const url = provider._getConnection().url
    transport = http(url)
  } else if (provider instanceof ethers.BrowserProvider) {
    transport = http()
  } else {
    throw new Error('Unsupported provider')
  }

  return createClient({
    chain,
    transport,
  })
}

export async function signerToConnectorClient(
  signer: ethers.Signer,
  provider?: ethers.Provider
): Promise<Client<Transport, Chain, Account>> {
  const _provider = provider ?? signer.provider
  if (!_provider) {
    throw new Error('No provider found')
  }
  const network = await _provider.getNetwork()
  const chainId = Number(network.chainId)
  const chain = getChain(chainId)

  let transport: Transport
  let account: Account | Address

  if ((signer as any).privateKey) {
    account = privateKeyToAccount((signer as any).privateKey)
  } else if (_provider instanceof ethers.BrowserProvider) {
    const signer = await _provider.getSigner()
    account = (await signer.getAddress()) as Address
  } else {
    throw new Error('Unsupported signer')
  }

  if (provider instanceof ethers.WebSocketProvider) {
    // @ts-expect-error
    const url = provider.websocket.url
    transport = webSocket(url)
  } else if (provider instanceof ethers.JsonRpcProvider) {
    const url = provider._getConnection().url
    transport = http(url)
  } else if (provider instanceof ethers.BrowserProvider) {
    // @ts-expect-error
    transport = custom(window.ethereum)
  } else {
    throw new Error('Unsupported provider')
  }

  return createWalletClient({
    chain,
    transport,
    account,
  })
}
