/**
 * @module @filoz/synapse-core/foc-devnet-info
 *
 * Library for validating and transforming FOC devnet configuration exports.
 * Environment-agnostic - works in both Node.js and browsers.
 */

import type { Chain } from 'viem'
import { type VersionedDevnetInfo, validateDevnetInfo } from './schema.ts'

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
 * Load and validate devnet info from parsed JSON data.
 *
 * @param data - The parsed devnet-info.json data
 * @returns Validated devnet info: { version: number, info: DevnetInfoV1 }
 * @throws {Error} If validation fails
 *
 * @example
 * // In Node.js
 * import { readFileSync } from 'fs';
 * import { loadDevnetInfo } from '@filoz/synapse-core/foc-devnet-info';
 *
 * const data = JSON.parse(readFileSync('devnet-info.json', 'utf8'));
 * const devnetInfo = loadDevnetInfo(data);
 *
 * @example
 * // In browser
 * import { loadDevnetInfo } from '@filoz/synapse-core/foc-devnet-info';
 *
 * const response = await fetch('/devnet-info.json');
 * const data = await response.json();
 * const devnetInfo = loadDevnetInfo(data);
 */
export function loadDevnetInfo(data: unknown): VersionedDevnetInfo {
  return validateDevnetInfo(data)
}

/**
 * Create a viem Chain object from devnet info.
 * This is compatible with viem and can be used with Synapse SDK.
 *
 * @param devnetInfo - The devnet info from loadDevnetInfo()
 * @returns viem Chain object
 *
 * @example
 * import { loadDevnetInfo, toViemChain } from '@filoz/synapse-core/foc-devnet-info';
 * import { createPublicClient, http } from 'viem';
 *
 * const data = JSON.parse(await (await fetch('/devnet-info.json')).text());
 * const devnetInfo = loadDevnetInfo(data);
 * const chain = toViemChain(devnetInfo);
 *
 * const client = createPublicClient({
 *   chain,
 *   transport: http()
 * });
 */
export function toViemChain(devnetInfo: VersionedDevnetInfo): Chain {
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
      fwss: {
        address: contracts.fwss_service_proxy_addr as `0x${string}`,
        blockCreated: 0,
      },
      fwssStateView: {
        address: contracts.fwss_state_view_addr as `0x${string}`,
        blockCreated: 0,
      },
      fwssImpl: {
        address: contracts.fwss_impl_addr as `0x${string}`,
        blockCreated: 0,
      },
      pdpVerifier: {
        address: contracts.pdp_verifier_proxy_addr as `0x${string}`,
        blockCreated: 0,
      },
      pdpVerifierImpl: {
        address: contracts.pdp_verifier_impl_addr as `0x${string}`,
        blockCreated: 0,
      },
      serviceProviderRegistry: {
        address: contracts.service_provider_registry_proxy_addr as `0x${string}`,
        blockCreated: 0,
      },
      serviceProviderRegistryImpl: {
        address: contracts.service_provider_registry_impl_addr as `0x${string}`,
        blockCreated: 0,
      },
      filecoinPay: {
        address: contracts.filecoin_pay_v1_addr as `0x${string}`,
        blockCreated: 0,
      },
      endorsements: {
        address: contracts.endorsements_addr as `0x${string}`,
        blockCreated: 0,
      },
      usdfc: {
        address: contracts.mockusdfc_addr as `0x${string}`,
        blockCreated: 0,
      },
    },
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
