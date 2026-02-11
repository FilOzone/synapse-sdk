/**
 * @module @filoz/synapse-core/foc-devnet-info/schema
 *
 * Zod schema for validating DevNet info exports.
 *
 * This schema ensures strict type checking and validates that all required
 * fields are present with correct types. It's used by the library to
 * validate the exported devnet-info.json file.
 */

import { z } from 'zod'

const YugabyteInfo = z.object({
  web_ui_url: z.string().url(),
  master_rpc_port: z.number().int().positive(),
  ysql_port: z.number().int().positive(),
})

const CurioInfo = z.object({
  provider_id: z.number().int().positive(),
  eth_addr: z.string().startsWith('0x'),
  native_addr: z.string().min(1),
  pdp_service_url: z.string().url(),
  container_id: z.string().min(1),
  container_name: z.string().min(1),
  is_approved: z.boolean(),
  is_endorsed: z.boolean(),
  yugabyte: YugabyteInfo,
})

const ContractsInfo = z.object({
  multicall3_addr: z.string().startsWith('0x'),
  mockusdfc_addr: z.string().startsWith('0x'),
  fwss_service_proxy_addr: z.string().startsWith('0x'),
  fwss_state_view_addr: z.string().startsWith('0x'),
  fwss_impl_addr: z.string().startsWith('0x'),
  pdp_verifier_proxy_addr: z.string().startsWith('0x'),
  pdp_verifier_impl_addr: z.string().startsWith('0x'),
  service_provider_registry_proxy_addr: z.string().startsWith('0x'),
  service_provider_registry_impl_addr: z.string().startsWith('0x'),
  filecoin_pay_v1_addr: z.string().startsWith('0x'),
  endorsements_addr: z.string().startsWith('0x'),
  session_key_registry_addr: z.string().startsWith('0x'),
})

const UserInfo = z.object({
  name: z.string().regex(/^USER_\d+$/),
  evm_addr: z.string().startsWith('0x'),
  native_addr: z.string().min(1),
  private_key_hex: z.string().startsWith('0x'),
})

const LotusInfo = z.object({
  host_rpc_url: z.string().url(),
  container_id: z.string().min(1),
  container_name: z.string().min(1),
})

const LotusMinerInfo = z.object({
  container_id: z.string().min(1),
  container_name: z.string().min(1),
  api_port: z.number().int().positive(),
})

const DevnetInfoV1 = z.object({
  run_id: z.string().min(1),
  start_time: z.string(),
  startup_duration: z.string().min(1),
  users: z.array(UserInfo).min(1),
  contracts: ContractsInfo,
  lotus: LotusInfo,
  lotus_miner: LotusMinerInfo,
  pdp_sps: z.array(CurioInfo).min(1),
})

export const VersionedDevnetInfo = z.object({
  version: z.literal(1),
  info: DevnetInfoV1,
})

// Export TypeScript types
export type YugabyteInfo = z.infer<typeof YugabyteInfo>
export type CurioInfo = z.infer<typeof CurioInfo>
export type ContractsInfo = z.infer<typeof ContractsInfo>
export type UserInfo = z.infer<typeof UserInfo>
export type LotusInfo = z.infer<typeof LotusInfo>
export type LotusMinerInfo = z.infer<typeof LotusMinerInfo>
export type DevnetInfoV1 = z.infer<typeof DevnetInfoV1>
export type VersionedDevnetInfo = z.infer<typeof VersionedDevnetInfo>

/**
 * Validate DevNet info against schema.
 * @param data - The parsed JSON data to validate
 * @returns The validated data if successful
 * @throws {Error} If validation fails
 */
export function validateDevnetInfo(data: unknown): VersionedDevnetInfo {
  try {
    return VersionedDevnetInfo.parse(data)
  } catch (error) {
    throw new Error(`DevNet info schema validation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
