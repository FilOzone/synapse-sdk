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
  /**
   * The genesis timestamp of the chain in seconds (Unix timestamp)
   */
  genesisTimestamp: number
  /**
   * The contracts of the chain
   */
  contracts: {
    multicall3: ChainContract
    usdfc: {
      address: Address
      abi: typeof Abis.erc20WithPermit
    }
    filecoinPay: {
      address: Address
      abi: typeof Abis.filecoinPay
    }
    fwss: {
      address: Address
      abi: typeof Abis.fwss
    }
    fwssView: {
      address: Address
      abi: typeof Abis.fwssView
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
    endorsements: {
      address: Address
      abi: typeof Abis.providerIdSet
    }
  }
  filbeam: {
    retrievalDomain: string
  } | null
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
    filecoinPay: {
      address: Abis.generated.filecoinPayV1Address['314'],
      abi: Abis.filecoinPay,
    },
    fwss: {
      address: Abis.generated.filecoinWarmStorageServiceAddress['314'],
      abi: Abis.fwss,
    },
    fwssView: {
      address: Abis.generated.filecoinWarmStorageServiceStateViewAddress['314'],
      abi: Abis.fwssView,
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
    endorsements: {
      address: Abis.generated.providerIdSetAddress['314'],
      abi: Abis.providerIdSet,
    },
  },
  filbeam: {
    retrievalDomain: 'filbeam.io',
  },
  /**
   * Filecoin Mainnet genesis: August 24, 2020 22:00:00 UTC
   */
  genesisTimestamp: 1598306400,
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
    filecoinPay: {
      address: Abis.generated.filecoinPayV1Address['314159'],
      abi: Abis.filecoinPay,
    },
    fwss: {
      address: Abis.generated.filecoinWarmStorageServiceAddress['314159'],
      abi: Abis.fwss,
    },
    fwssView: {
      address: Abis.generated.filecoinWarmStorageServiceStateViewAddress['314159'],
      abi: Abis.fwssView,
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
    endorsements: {
      address: Abis.generated.providerIdSetAddress['314159'],
      abi: Abis.providerIdSet,
    },
  },
  filbeam: {
    retrievalDomain: 'calibration.filbeam.io',
  },
  testnet: true,
  /**
   * Filecoin Calibration testnet genesis: November 1, 2022 18:13:00 UTC
   */
  genesisTimestamp: 1667326380,
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
    filecoinPay: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.filecoinPay,
    },
    fwss: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.fwss,
    },
    fwssView: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.fwssView,
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
    endorsements: {
      address: '0x0000000000000000000000000000000000000000',
      abi: Abis.providerIdSet,
    },
  },
  filbeam: null,
  testnet: true,
  /**
   * Filecoin Devnet genesis: Set to 0 as placeholder. Epoch<>Date conversions (epochToDate,
   * dateToEpoch) will return incorrect results on devnet. Core contract operations
   * are unaffected as they use epochs directly.
   */
  genesisTimestamp: 0,
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
  if (
    chain.contracts &&
    'filecoinPay' in chain.contracts &&
    'fwss' in chain.contracts &&
    'genesisTimestamp' in chain &&
    [mainnet.id, calibration.id, devnet.id].includes(chain.id)
  ) {
    return chain as Chain
  }
  throw new UnsupportedChainError(chain.id)
}

export namespace asChain {
  export type ErrorType = UnsupportedChainError
}
