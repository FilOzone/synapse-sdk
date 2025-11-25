import type { Address, Chain, Client, Transport } from 'viem'
import { readContract } from 'viem/actions'
import { getChain } from '../chains.ts'
import { PRB_ONE, prbDiv, prbExp2 } from './prb.ts'

/**
 * Transaction fees are sold in a recurring Dutch auction.
 * Anyone can purchase the accrued fees with FIL.
 * The purchase price decays 75% per week.
 */
export type AuctionInfo = {
  token: Address
  startPrice: bigint
  startTime: bigint
}

/**
 * Get the initial state of the current FilecoinPay auction
 * This auction information can be passed to auctionPriceAt to calculate the current price
 * Auctions are dutch, so the acceptance price decreases over time
 * Each token has a separate auction
 * @param client used to read the FilecoinPay contract
 * @param token specifies which token's auction
 * @returns the auction startPrice and startTime
 */
export async function auctionInfo(client: Client<Transport, Chain>, token: Address): Promise<AuctionInfo> {
  const chain = getChain(client.chain.id)
  const [startPrice, startTime] = await readContract(client, {
    address: chain.contracts.payments.address,
    abi: chain.contracts.payments.abi,
    functionName: 'auctionInfo',
    args: [token],
  })
  return {
    startPrice,
    startTime,
    token,
  }
}

/**
 * Get the current funds available in the FilecoinPay auction
 * These auction funds accrue as payment rails settle
 * Each token has a separate auction
 * @param client used to read the FilecoinPay contract
 * @param token specifies which token's auction
 * @returns how much of the token is available to purchasae in the auction
 */
export async function auctionFunds(client: Client<Transport, Chain>, token: Address): Promise<bigint> {
  const chain = getChain(client.chain.id)
  const [funds] = await readContract(client, {
    address: chain.contracts.payments.address,
    abi: chain.contracts.payments.abi,
    functionName: 'accounts',
    args: [token, chain.contracts.payments.address],
  })
  return funds
}

export const HALVING_SECONDS = 7n * 12n * 60n * 60n
const MAX_DELAY = HALVING_SECONDS * 192n

/**
 * The acceptance price decays 75% per week
 * @param auction dutch auction information
 * @param timestamp seconds since 1970
 * @returns how much FIL is required to purchase the transaction fees
 */
export function auctionPriceAt(auction: AuctionInfo, timestamp: bigint): bigint {
  const elapsed = timestamp - auction.startTime
  if (elapsed <= 0) {
    return auction.startPrice
  }
  if (elapsed >= MAX_DELAY) {
    return 0n
  }
  return prbDiv(auction.startPrice, prbExp2((elapsed * PRB_ONE) / HALVING_SECONDS))
}
