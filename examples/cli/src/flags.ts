import { isAddress } from 'viem'

const possibleChains = [314159, 314] as const
type Chains = (typeof possibleChains)[number]

const Chain = (chainStr: string) => {
  const chain = Number(chainStr) as Chains
  if (!possibleChains.includes(chain)) {
    throw new Error(
      `Invalid chain: ${chain}. Must be one of: ${possibleChains.join(', ')}`
    )
  }
  return chain
}

export const Address = (addressStr: string) => {
  if (!isAddress(addressStr)) {
    throw new Error(`Invalid address: ${addressStr}`)
  }
  return addressStr
}

export const globalFlags = {
  chain: {
    type: Chain,
    description: 'The chain to use. 314159 for calibration, 314 for mainnet',
    default: 314159,
  },
  debug: {
    type: Boolean,
    description: 'Enable debug mode',
    default: false,
  },
}
