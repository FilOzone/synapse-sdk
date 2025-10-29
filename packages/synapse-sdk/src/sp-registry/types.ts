/**
 * Types for ServiceProviderRegistry interaction
 */

import type { PDPOffering } from '@filoz/synapse-core/warm-storage'

export type { PDPOffering }

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
  serviceProvider: string // TODO Hex
  payee: string
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
 * Provider registration info for new providers
 */
export interface ProviderRegistrationInfo {
  payee: string
  name: string
  description: string
  pdpOffering: PDPOffering
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
