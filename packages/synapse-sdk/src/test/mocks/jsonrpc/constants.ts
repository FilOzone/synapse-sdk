import type { Address } from 'viem'
import { CONTRACT_ADDRESSES } from '../../../utils/constants.ts'

export const PRIVATE_KEYS = {
  key1: '0x1234567890123456789012345678901234567890123456789012345678901234',
  key2: '0x4123456789012345678901234567890123456789012345678901234567890123',
}
export const ADDRESSES = {
  client1: '0x2e988A386a799F506693793c6A5AF6B54dfAaBfB' as Address,
  zero: '0x0000000000000000000000000000000000000000' as Address,
  serviceProvider1: '0x0000000000000000000000000000000000000001' as Address,
  serviceProvider2: '0x0000000000000000000000000000000000000002' as Address,
  payee1: '0x1000000000000000000000000000000000000001' as Address,
  mainnet: {
    warmStorage: '0x1234567890123456789012345678901234567890' as Address,
    multicall3: CONTRACT_ADDRESSES.MULTICALL3.mainnet,
    pdpVerifier: '0x9876543210987654321098765432109876543210',
  },
  calibration: {
    warmStorage: CONTRACT_ADDRESSES.WARM_STORAGE.calibration as Address,
    multicall3: CONTRACT_ADDRESSES.MULTICALL3.calibration,
    pdpVerifier: '0x3ce3C62C4D405d69738530A6A65E4b13E8700C48' as Address,
    payments: '0x80Df863d84eFaa0aaC8da2E9B08D14A7236ff4D0' as Address,
    usdfcToken: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0' as Address,
    filCDN: '0x0000000000000000000000000000000000000000' as Address,
    viewContract: '0x1996B60838871D0bc7980Bc02DD6Eb920535bE54' as Address,
    spRegistry: '0x0000000000000000000000000000000000000001' as Address,
    sessionKeyRegistry: '0x97Dd879F5a97A8c761B94746d7F5cfF50AAd4452' as Address,
  },
}

export const PROVIDERS = {
  providerNoPDP: {
    providerId: 1n,
    providerInfo: {
      serviceProvider: ADDRESSES.serviceProvider1,
      payee: ADDRESSES.payee1,
      name: 'Provider 1',
      description: 'Test provider 1',
      isActive: true,
    },
    products: [],
  },
  provider1: {
    providerId: 1n,
    providerInfo: {
      serviceProvider: ADDRESSES.serviceProvider1,
      payee: ADDRESSES.payee1,
      name: 'Provider 1',
      description: 'Test provider 1',
      isActive: true,
    },
    products: [
      {
        productType: 0,
        isActive: true,
        offering: {
          serviceURL: 'https://provider1.example.com',
          minPieceSizeInBytes: 1024n,
          maxPieceSizeInBytes: 32n * 1024n * 1024n * 1024n,
          ipniPiece: false,
          ipniIpfs: false,
          storagePricePerTibPerDay: 1000000n,
          minProvingPeriodInEpochs: 30n,
          location: 'us-east',
          paymentTokenAddress: ADDRESSES.calibration.usdfcToken,
        },
      },
    ],
  },
  provider2: {
    providerId: 2n,
    providerInfo: {
      serviceProvider: ADDRESSES.serviceProvider2,
      payee: ADDRESSES.payee1,
      name: 'Provider 2',
      description: 'Test provider 2',
      isActive: true,
    },
    products: [
      {
        productType: 0,
        isActive: true,
        offering: {
          serviceURL: 'https://provider2.example.com',
          minPieceSizeInBytes: 1024n,
          maxPieceSizeInBytes: 32n * 1024n * 1024n * 1024n,
          ipniPiece: false,
          ipniIpfs: false,
          storagePricePerTibPerDay: 1000000n,
          minProvingPeriodInEpochs: 30n,
          location: 'us-east',
          paymentTokenAddress: ADDRESSES.calibration.usdfcToken,
        },
      },
    ],
  },
  providerIPNI: {
    providerId: 2n,
    providerInfo: {
      serviceProvider: ADDRESSES.serviceProvider2,
      payee: ADDRESSES.payee1,
      name: 'Provider 2',
      description: 'Test provider 2',
      isActive: true,
    },
    products: [
      {
        productType: 0,
        isActive: true,
        offering: {
          serviceURL: 'https://provider2.example.com',
          minPieceSizeInBytes: 1024n,
          maxPieceSizeInBytes: 32n * 1024n * 1024n * 1024n,
          ipniPiece: true,
          ipniIpfs: true,
          storagePricePerTibPerDay: 1000000n,
          minProvingPeriodInEpochs: 30n,
          location: 'us-east',
          paymentTokenAddress: ADDRESSES.calibration.usdfcToken,
        },
      },
    ],
  },
}
