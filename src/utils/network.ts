/**
 * Network utilities for Filecoin network detection and validation
 */

import type { ethers } from 'ethers'
import type { FilecoinNetworkType } from '../types.ts'
import { CHAIN_IDS } from './constants.ts'
import { createError } from './errors.ts'

/**
 * Extract and validate FilecoinNetworkType from an ethers Provider
 *
 * Uses chainId for network detection since the actual network name from ethers
 * will be something like "Filecoin Calibration Testnet" rather than just "calibration".
 *
 * @param provider - Ethers provider to get network from
 * @returns Promise resolving to validated FilecoinNetworkType
 * @throws Error if the network is not supported
 */
export async function getFilecoinNetworkType(provider: ethers.Provider): Promise<FilecoinNetworkType> {
  try {
    const network = await provider.getNetwork()
    const chainId = Number(network.chainId)

    if (chainId === CHAIN_IDS.mainnet) {
      return 'mainnet'
    } else if (chainId === CHAIN_IDS.calibration) {
      return 'calibration'
    } else {
      throw createError(
        'NetworkUtils',
        'getFilecoinNetworkType',
        `Unsupported network: chain ID ${chainId}. Only Filecoin mainnet (${CHAIN_IDS.mainnet}) and calibration (${CHAIN_IDS.calibration}) are supported.`
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unsupported network')) {
      throw error // Re-throw our own error
    }
    throw createError(
      'NetworkUtils',
      'getFilecoinNetworkType',
      `Failed to detect network: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
