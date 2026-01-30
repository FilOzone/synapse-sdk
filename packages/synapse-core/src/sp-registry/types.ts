import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import type { Hex } from 'viem'
import type * as Abis from '../abis/index.ts'

/**
 * Product types supported by the registry
 */
export const PRODUCTS = {
  PDP: 0,
} as const

export type ProductType = (typeof PRODUCTS)[keyof typeof PRODUCTS]

export type getProviderWithProductType = ExtractAbiFunction<
  typeof Abis.serviceProviderRegistry,
  'getProviderWithProduct'
>

export type ProviderWithProduct = AbiParametersToPrimitiveTypes<getProviderWithProductType['outputs']>[0]

export type ProviderInfo = AbiParametersToPrimitiveTypes<getProviderWithProductType['outputs']>[0]['providerInfo']

export interface PDPProvider extends ProviderInfo {
  id: bigint
  pdp: PDPOffering
}

/**
 * PDP offering details (decoded from capability k/v pairs)
 *
 * @see https://github.com/FilOzone/filecoin-services/blob/a86e4a5018133f17a25b4bb6b5b99da4d34fe664/service_contracts/src/ServiceProviderRegistry.sol#L14
 */
export interface PDPOffering {
  /**
   * The URL of the service.
   */
  serviceURL: string
  /**
   * The minimum piece size in bytes.
   */
  minPieceSizeInBytes: bigint
  /**
   * The maximum piece size in bytes.
   */
  maxPieceSizeInBytes: bigint
  /**
   * Storage price per TiB per day (in token's smallest unit).
   */
  storagePricePerTibPerDay: bigint
  /**
   * The minimum proving period in epochs.
   */
  minProvingPeriodInEpochs: bigint
  /**
   * Geographic location of the service provider
   */
  location: string
  /**
   * Token contract for payment (IERC20(address(0)) for FIL)
   */
  paymentTokenAddress: Hex
  /**
   * Whether the service supports IPNI piece.
   */
  ipniPiece: boolean
  /**
   * Whether the service supports IPNI IPFS.
   */
  ipniIpfs: boolean
  /**
   * The IPNI peer ID.
   */
  ipniPeerId?: string
}
