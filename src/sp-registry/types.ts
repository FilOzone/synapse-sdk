/**
 * Types for ServiceProviderRegistry interaction
 */

/**
 * Product types supported by the registry
 */
export const PRODUCTS = {
  PDP: 0,
} as const
export type ProductType = (typeof PRODUCTS)[keyof typeof PRODUCTS]

/**
 * Decoded provider info for SDK use
 */
export interface ProviderInfo {
  id: number
  address: string
  name: string
  description: string
  active: boolean
  // Map of product type to product data for direct access
  products: Partial<Record<'PDP', ServiceProduct>>
}

/**
 * Polymorphic service product interface
 */
export interface ServiceProduct {
  type: 'PDP'
  isActive: boolean
  capabilities: Record<string, string> // Object map of capability key-value pairs
  data: PDPOffering
}

/**
 * PDP offering details (decoded from productData)
 */
export interface PDPOffering {
  serviceURL: string
  minPieceSizeInBytes: bigint
  maxPieceSizeInBytes: bigint
  ipniPiece: boolean
  ipniIpfs: boolean
  storagePricePerTibPerMonth: bigint
  minProvingPeriodInEpochs: number
  location: string
  paymentTokenAddress: string
}

/**
 * Provider registration info for new providers
 */
export interface ProviderRegistrationInfo {
  name: string
  description: string
  pdpOffering?: PDPOffering
  capabilities?: Record<string, string> // Object map of capability key-value pairs
}

/**
 * PDP service info returned from getPDPService
 */
export interface PDPServiceInfo {
  offering: PDPOffering
  capabilities: Record<string, string> // Object map of capability key-value pairs
  isActive: boolean
}
