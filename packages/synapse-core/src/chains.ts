/**
 * Synapse Core - Chains
 *
 * @example
 * ```ts
 * import * as Chains from '@filoz/synapse-core/chains'
 * ```
 *
 * @packageDocumentation
 * @module Chains
 */

import type { Address, ChainContract, Chain as ViemChain } from 'viem'
import { ERC20_WITH_PERMIT_ABI } from './constants.ts'
import * as generated from './gen.ts'

/**
 * Viem compatible chain interface with all the FOC contracts addresses and ABIs
 */
export interface Chain extends ViemChain {
  contracts: {
    multicall3: ChainContract
    usdfc: {
      address: Address
      abi: typeof ERC20_WITH_PERMIT_ABI
    }
    payments: {
      address: Address
      abi: typeof generated.paymentsAbi
    }
    storage: {
      address: Address
      abi: typeof generated.filecoinWarmStorageServiceAbi
    }
    storageView: {
      address: Address
      abi: typeof generated.filecoinWarmStorageServiceStateViewAbi
    }
    serviceProviderRegistry: {
      address: Address
      abi: typeof generated.serviceProviderRegistryAbi
    }
    sessionKeyRegistry: {
      address: Address
      abi: typeof generated.sessionKeyRegistryAbi
    }
    pdp: {
      address: Address
      abi: typeof generated.pdpVerifierAbi
    }
  }
}

/**
 * Filecoin Mainnet
 *
 * Compatible with Viem
 *
 */
export const mainnet: Chain = {
  id: 314,
  name: 'Filecoin - Mainnet',
  nativeCurrency: {
    name: 'Filecoin',
    symbol: 'FIL',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://api.node.glif.io/rpc/v1'],
      webSocket: ['wss://wss.node.glif.io/apigw/lotus/rpc/v1'],
    },
  },
  blockExplorers: {
    Beryx: {
      name: 'Beryx',
      url: 'https://beryx.io/fil/mainnet',
    },
    Filfox: {
      name: 'Filfox',
      url: 'https://filfox.info',
    },
    Glif: {
      name: 'Glif',
      url: 'https://www.glif.io/en',
    },
    default: {
      name: 'Blockscout',
      url: 'https://filecoin.blockscout.com',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 3328594,
    },
    usdfc: {
      address: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045',
      abi: ERC20_WITH_PERMIT_ABI,
    },
    payments: {
      address: generated.paymentsAddress['314'],
      abi: generated.paymentsAbi,
    },
    storage: {
      address: generated.filecoinWarmStorageServiceAddress['314'],
      abi: generated.filecoinWarmStorageServiceAbi,
    },
    storageView: {
      address: generated.filecoinWarmStorageServiceStateViewAddress['314'],
      abi: generated.filecoinWarmStorageServiceStateViewAbi,
    },
    serviceProviderRegistry: {
      address: generated.serviceProviderRegistryAddress['314'],
      abi: generated.serviceProviderRegistryAbi,
    },
    sessionKeyRegistry: {
      address: generated.sessionKeyRegistryAddress['314'],
      abi: generated.sessionKeyRegistryAbi,
    },
    pdp: {
      address: generated.pdpVerifierAddress['314'],
      abi: generated.pdpVerifierAbi,
    },
  },
}

/**
 * Filecoin Calibration
 *
 * Compatible with Viem
 *
 */
export const calibration: Chain = {
  id: 314_159,
  name: 'Filecoin - Calibration testnet',
  nativeCurrency: {
    name: 'Filecoin',
    symbol: 'tFIL',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://api.calibration.node.glif.io/rpc/v1'],
      webSocket: ['wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1'],
    },
  },
  blockExplorers: {
    Beryx: {
      name: 'Beryx',
      url: 'https://beryx.io/fil/calibration',
    },
    Filfox: {
      name: 'Filfox',
      url: 'https://calibration.filfox.info',
    },
    Glif: {
      name: 'Glif',
      url: 'https://www.glif.io/en/calibrationnet',
    },
    default: {
      name: 'Blockscout',
      url: 'https://filecoin-testnet.blockscout.com',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 1446201,
    },
    usdfc: {
      address: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
      abi: ERC20_WITH_PERMIT_ABI,
    },
    payments: {
      address: generated.paymentsAddress['314159'],
      abi: generated.paymentsAbi,
    },
    storage: {
      address: generated.filecoinWarmStorageServiceAddress['314159'],
      abi: generated.filecoinWarmStorageServiceAbi,
    },
    storageView: {
      address: generated.filecoinWarmStorageServiceStateViewAddress['314159'],
      abi: generated.filecoinWarmStorageServiceStateViewAbi,
    },
    serviceProviderRegistry: {
      address: generated.serviceProviderRegistryAddress['314159'],
      abi: generated.serviceProviderRegistryAbi,
    },
    sessionKeyRegistry: {
      address: generated.sessionKeyRegistryAddress['314159'],
      abi: generated.sessionKeyRegistryAbi,
    },
    pdp: {
      address: generated.pdpVerifierAddress['314159'],
      abi: generated.pdpVerifierAbi,
    },
  },
  testnet: true,
}

/**
 * Get a chain by id
 *
 * @param [id] - The chain id. Defaults to mainnet.
 */
export function getChain(id?: number): Chain {
  if (id == null) {
    return mainnet
  }

  switch (id) {
    case 314:
      return mainnet
    case 314159:
      return calibration
    default:
      throw new Error(`Chain with id ${id} not found`)
  }
}
