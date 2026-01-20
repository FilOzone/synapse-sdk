import * as Mocks from '@filoz/synapse-core/mocks'
import type { ProviderInfo } from '../sp-registry/types.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'

/**
 * Create a mock ProviderInfo object for testing
 */
function createMockProviderInfo(overrides?: Partial<ProviderInfo>): ProviderInfo {
  const defaults: ProviderInfo = {
    id: 1,
    serviceProvider: Mocks.ADDRESSES.client1,
    payee: Mocks.ADDRESSES.client1, // Usually same as serviceProvider for tests
    name: 'Test Provider',
    description: 'A test storage provider',
    active: true,
    products: {
      PDP: {
        type: 'PDP',
        isActive: true,
        capabilities: {},
        data: {
          serviceURL: 'https://provider.example.com',
          minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
          maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
          ipniPiece: false,
          ipniIpfs: false,
          ipniPeerID: '',
          storagePricePerTibPerDay: BigInt(1000000),
          minProvingPeriodInEpochs: 2880n,
          location: 'US',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      },
    },
  }

  // Deep merge products to preserve nested capabilities
  const result = { ...defaults, ...overrides }
  if (overrides?.products?.PDP && defaults.products.PDP) {
    result.products = {
      ...defaults.products,
      PDP: {
        ...defaults.products.PDP,
        ...overrides.products.PDP,
        capabilities: {
          ...defaults.products.PDP.capabilities,
          ...overrides.products.PDP.capabilities,
        },
        data: {
          ...defaults.products.PDP.data,
          ...overrides.products.PDP.data,
        },
      },
    }
  }

  return result
}

/**
 * Create a mock provider with minimal fields (for backward compatibility)
 *
 * @TODO: REMOVE THIS once we figure out what to do with retriever-subgraph.test.ts
 */
export function createSimpleProvider(props: {
  address?: string
  serviceProvider?: string
  serviceURL: string
}): ProviderInfo {
  return createMockProviderInfo({
    serviceProvider: props.serviceProvider ?? props.address ?? Mocks.ADDRESSES.client1,
    products: {
      PDP: {
        type: 'PDP',
        isActive: true,
        capabilities: {},
        data: {
          serviceURL: props.serviceURL,
          minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
          maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
          ipniPiece: false,
          ipniIpfs: false,
          ipniPeerID: '',
          storagePricePerTibPerDay: BigInt(1000000),
          minProvingPeriodInEpochs: 2880n,
          location: 'US',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      },
    },
  })
}
