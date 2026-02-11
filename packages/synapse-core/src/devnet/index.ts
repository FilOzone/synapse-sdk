/**
 * @module @filoz/synapse-core/devnet
 *
 * Validates and transforms foc-devnet's devnet-info.json into Synapse-compatible configuration.
 * See https://github.com/FilOzone/foc-devnet for the export format.
 */

import * as Abis from '../abis/index.ts'
import type { Chain } from '../chains.ts'
import type { VersionedDevnetInfo } from './schema.ts'

/**
 * Environment variables generated from devnet info
 */
export interface DevnetEnvVars {
  RPC_URL: string
  PRIVATE_KEY: string
  EVM_ADDRESS: string
  NATIVE_ADDRESS: string
  MULTICALL3_ADDRESS: string
  USDFC_ADDRESS: string
  FWSS_PROXY_ADDRESS: string
  PDP_VERIFIER_PROXY_ADDRESS: string
  SP_REGISTRY_ADDRESS: string
  FILECOIN_PAY_ADDRESS: string
  ENDORSEMENTS_ADDRESS: string
  RUN_ID: string
  START_TIME: string
}

/**
 * Create a Synapse Chain object from devnet info.
 * This is compatible with viem and includes all ABIs needed by the Synapse SDK.
 *
 * @param devnetInfo - The devnet info from validateDevnetInfo()
 * @returns Synapse Chain object with contract ABIs and addresses
 *
 */
export function toChain(devnetInfo: VersionedDevnetInfo): Chain {
  const { info } = devnetInfo
  const contracts = info.contracts

  return {
    id: 31415926,
    name: 'FOC DevNet',
    nativeCurrency: {
      decimals: 18,
      name: 'Filecoin',
      symbol: 'FIL',
    },
    rpcUrls: {
      default: { http: [info.lotus.host_rpc_url] },
      public: { http: [info.lotus.host_rpc_url] },
    },
    blockExplorers: {
      default: {
        name: 'DevNet',
        url: 'http://localhost:3000',
      },
    },
    contracts: {
      multicall3: {
        address: contracts.multicall3_addr as `0x${string}`,
        blockCreated: 0,
      },
      usdfc: {
        address: contracts.mockusdfc_addr as `0x${string}`,
        abi: Abis.erc20WithPermit,
      },
      filecoinPay: {
        address: contracts.filecoin_pay_v1_addr as `0x${string}`,
        abi: Abis.filecoinPay,
      },
      fwss: {
        address: contracts.fwss_service_proxy_addr as `0x${string}`,
        abi: Abis.fwss,
      },
      fwssView: {
        address: contracts.fwss_state_view_addr as `0x${string}`,
        abi: Abis.fwssView,
      },
      serviceProviderRegistry: {
        address: contracts.service_provider_registry_proxy_addr as `0x${string}`,
        abi: Abis.serviceProviderRegistry,
      },
      sessionKeyRegistry: {
        address: contracts.session_key_registry_addr as `0x${string}`,
        abi: Abis.sessionKeyRegistry,
      },
      pdp: {
        address: contracts.pdp_verifier_proxy_addr as `0x${string}`,
        abi: Abis.pdp,
      },
      endorsements: {
        address: contracts.endorsements_addr as `0x${string}`,
        abi: Abis.providerIdSet,
      },
    },
    filbeam: null,
    testnet: true,
    /**
     * Devnet genesis: Set to 0 as placeholder. Epoch<>Date conversions
     * will return incorrect results on devnet. Core contract operations
     * are unaffected as they use epochs directly.
     */
    genesisTimestamp: 0,
  }
}

export type {
  ContractsInfo,
  CurioInfo,
  DevnetInfoV1,
  LotusInfo,
  LotusMinerInfo,
  UserInfo,
  VersionedDevnetInfo,
  YugabyteInfo,
} from './schema.ts'
// Re-export schema types and validation for advanced usage
export { validateDevnetInfo } from './schema.ts'
