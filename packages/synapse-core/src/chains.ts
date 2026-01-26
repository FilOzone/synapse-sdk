/**
 * Chains
 *
 * @example
 * ```ts
 * import * as Chains from '@filoz/synapse-core/chains'
 * ```
 *
 * @module chains
 */

import type { Address, ChainContract, Chain as ViemChain } from 'viem'
import * as Abis from './abis/index.ts'
import { UnsupportedChainError } from './errors/chains.ts'

/**
 * Viem compatible chain interface with all the FOC contracts addresses and ABIs
 */
export interface Chain extends ViemChain {
  contracts: {
    multicall3: ChainContract
    usdfc: {
      address: Address
      abi: typeof Abis.erc20WithPermit
    }
    payments: {
      address: Address
      abi: typeof Abis.payments
    }
    storage: {
      address: Address
      abi: typeof Abis.storage
    }
    storageView: {
      address: Address
      abi: typeof Abis.storageView
    }
    serviceProviderRegistry: {
      address: Address
      abi: typeof Abis.serviceProviderRegistry
    }
    sessionKeyRegistry: {
      address: Address
      abi: typeof Abis.sessionKeyRegistry
    }
    pdp: {
      address: Address
      abi: typeof Abis.pdp
    }
    providerIdSet: {
      address: Address
      abi: typeof Abis.providerIdSet
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
      abi: Abis.erc20WithPermit,
    },
    payments: {
      address: Abis.generated.filecoinPayV1Address['314'],
      abi: Abis.payments,
    },
    storage: {
      address: Abis.generated.filecoinWarmStorageServiceAddress['314'],
      abi: Abis.storage,
    },
    storageView: {
      address: Abis.generated.filecoinWarmStorageServiceStateViewAddress['314'],
      abi: Abis.storageView,
    },
    serviceProviderRegistry: {
      address: Abis.generated.serviceProviderRegistryAddress['314'],
      abi: Abis.serviceProviderRegistry,
    },
    sessionKeyRegistry: {
      address: Abis.generated.sessionKeyRegistryAddress['314'],
      abi: Abis.sessionKeyRegistry,
    },
    pdp: {
      address: Abis.generated.pdpVerifierAddress['314'],
      abi: Abis.pdp,
    },
    providerIdSet: {
      address: Abis.generated.providerIdSetAddress['314'],
      abi: Abis.providerIdSet,
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
      abi: Abis.erc20WithPermit,
    },
    payments: {
      address: Abis.generated.filecoinPayV1Address['314159'],
      abi: Abis.payments,
    },
    storage: {
      address: Abis.generated.filecoinWarmStorageServiceAddress['314159'],
      abi: Abis.storage,
    },
    storageView: {
      address: Abis.generated.filecoinWarmStorageServiceStateViewAddress['314159'],
      abi: Abis.storageView,
    },
    serviceProviderRegistry: {
      address: Abis.generated.serviceProviderRegistryAddress['314159'],
      abi: Abis.serviceProviderRegistry,
    },
    sessionKeyRegistry: {
      address: Abis.generated.sessionKeyRegistryAddress['314159'],
      abi: Abis.sessionKeyRegistry,
    },
    pdp: {
      address: Abis.generated.pdpVerifierAddress['314159'],
      abi: Abis.pdp,
    },
    providerIdSet: {
      address: Abis.generated.providerIdSetAddress['314159'],
      abi: Abis.providerIdSet,
    },
  },
  testnet: true,
}

/**
 * Filecoin Devnet
 *
 * Local development network. Contract addresses must be provided by the devnet deployment.
 */
export const devnet: Chain = {
  id: 31415926,
  name: 'Filecoin - Devnet',
  nativeCurrency: {
    name: 'Filecoin',
    symbol: 'FIL',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:5700/rpc/v1'],
      webSocket: ['ws://127.0.0.1:5700/rpc/v1'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Local Blockscout',
      url: 'http://localhost:8080',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 0,
    },
    usdfc: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.erc20WithPermit,
    },
    payments: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.payments,
    },
    storage: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.storage,
    },
    storageView: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.storageView,
    },
    serviceProviderRegistry: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.serviceProviderRegistry,
    },
    sessionKeyRegistry: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.sessionKeyRegistry,
    },
    pdp: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.pdp,
    },
    providerIdSet: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.providerIdSet,
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
    case 31415926:
      return devnet
    default:
      throw new Error(`Chain with id ${id} not found`)
  }
}

/**
 * Convert a viem chain to a filecoin chain.
 * @param chain - The viem chain.
 * @returns The filecoin chain.
 * @throws Errors {@link asChain.ErrorType}
 */
export function asChain(chain: ViemChain): Chain {
  if (chain.contracts && 'payments' in chain.contracts) {
    return chain as Chain
  }
  throw new UnsupportedChainError(chain.id)
}

export namespace asChain {
  export type ErrorType = UnsupportedChainError
}
