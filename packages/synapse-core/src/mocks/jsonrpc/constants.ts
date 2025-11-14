import { type Address, zeroAddress } from 'viem'
import { calibration, mainnet } from '../../chains.ts'

export const PRIVATE_KEYS = {
  key1: '0x1234567890123456789012345678901234567890123456789012345678901234',
  key2: '0x4123456789012345678901234567890123456789012345678901234567890123',
}
export const ADDRESSES = {
  client1: '0x2e988A386a799F506693793c6A5AF6B54dfAaBfB' as Address,
  zero: zeroAddress,
  serviceProvider1: '0x0000000000000000000000000000000000000001' as Address,
  serviceProvider2: '0x0000000000000000000000000000000000000002' as Address,
  payee1: '0x1000000000000000000000000000000000000001' as Address,
  mainnet: {
    warmStorage: mainnet.contracts.storage.address,
    multicall3: mainnet.contracts.multicall3.address,
    pdpVerifier: mainnet.contracts.pdp.address,
  },
  calibration: {
    warmStorage: calibration.contracts.storage.address,
    multicall3: calibration.contracts.multicall3.address,
    pdpVerifier: calibration.contracts.pdp.address,
    payments: calibration.contracts.payments.address,
    usdfcToken: calibration.contracts.usdfc.address,
    filCDN: zeroAddress,
    viewContract: calibration.contracts.storageView.address,
    spRegistry: calibration.contracts.serviceProviderRegistry.address,
    sessionKeyRegistry: calibration.contracts.sessionKeyRegistry.address,
  },
}

const ENDORSEMENTS = {
  '0x50724807600e804Fe842439860D5b62baa26aFff': {
    notAfter: 0xffffffffn,
    nonce: 0xffffffffn,
    signature:
      '0x1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b',
  },
} as const

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
          endorsements: ENDORSEMENTS,
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
          endorsements: ENDORSEMENTS,
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
          endorsements: ENDORSEMENTS,
        },
      },
    ],
  },
}
