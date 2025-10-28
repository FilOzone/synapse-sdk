import { request } from 'iso-web/http'
import type { Address, Hex } from 'viem'

export type ClaimTokensOptions = {
  address: Address
}

export type ClaimTokenResponse = [
  {
    faucetInfo: 'CalibnetUSDFC'
    tx_hash: Hex
  },
  {
    faucetInfo: 'CalibnetFIL'
    tx_hash: Hex
  },
]

export type ClaimTokenResponseError = [
  {
    faucetInfo: 'CalibnetUSDFC'
    error: { ServerError: string }
  },
  {
    faucetInfo: 'CalibnetFIL'
    error: { ServerError: string }
  },
]
export async function claimTokens(options: ClaimTokensOptions) {
  const response = await request.json.get<ClaimTokenResponse>(
    `https://forest-explorer.chainsafe.dev/api/claim_token_all?address=${options.address}`,
    {
      timeout: 20000,
    }
  )

  if (response.error) {
    throw new Error((response.error.cause as ClaimTokenResponseError)[0].error.ServerError)
  }

  return response.result
}
