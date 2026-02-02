import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, hexToBigInt, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { registerProvider, registerProviderCall } from '../src/sp-registry/register-provider.ts'
import { encodePDPCapabilities } from '../src/utils/pdp-capabilities.ts'

describe('registerProvider', () => {
  const server = setup()

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('registerProviderCall', () => {
    it('should create call with calibration chain defaults', () => {
      const pdpOffering = {
        serviceURL: 'https://provider.example.com',
        minPieceSizeInBytes: 1024n,
        maxPieceSizeInBytes: 1073741824n,
        storagePricePerTibPerDay: parseEther('0.1'),
        minProvingPeriodInEpochs: 2880n,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
        ipniPiece: false,
        ipniIpfs: false,
      }
      const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering)

      const call = registerProviderCall({
        chain: calibration,
        payee: '0x1234567890123456789012345678901234567890',
        name: 'Test Provider',
        description: 'Test Description',
        productType: 0,
        pdpOffering,
        value: parseEther('5'),
      })

      assert.equal(call.functionName, 'registerProvider')
      assert.equal(call.address, calibration.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, calibration.contracts.serviceProviderRegistry.abi)
      assert.equal(call.args[0], '0x1234567890123456789012345678901234567890')
      assert.equal(call.args[1], 'Test Provider')
      assert.equal(call.args[2], 'Test Description')
      assert.equal(call.args[3], 0)
      assert.deepEqual(call.args[4], capabilityKeys)
      assert.deepEqual(call.args[5], capabilityValues)
      assert.equal(call.value, parseEther('5'))
    })

    it('should create call with mainnet chain defaults', () => {
      const pdpOffering = {
        serviceURL: 'https://provider.example.com',
        minPieceSizeInBytes: 1024n,
        maxPieceSizeInBytes: 1073741824n,
        storagePricePerTibPerDay: parseEther('0.1'),
        minProvingPeriodInEpochs: 2880n,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
        ipniPiece: false,
        ipniIpfs: false,
      }
      const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering)

      const call = registerProviderCall({
        chain: mainnet,
        payee: '0x9876543210987654321098765432109876543210',
        name: 'Mainnet Provider',
        description: 'Mainnet Description',
        productType: 0,
        pdpOffering,
        value: parseEther('5'),
      })

      assert.equal(call.functionName, 'registerProvider')
      assert.equal(call.address, mainnet.contracts.serviceProviderRegistry.address)
      assert.equal(call.abi, mainnet.contracts.serviceProviderRegistry.abi)
      assert.equal(call.args[0], '0x9876543210987654321098765432109876543210')
      assert.equal(call.args[1], 'Mainnet Provider')
      assert.equal(call.args[2], 'Mainnet Description')
      assert.equal(call.args[3], 0)
      assert.deepEqual(call.args[4], capabilityKeys)
      assert.deepEqual(call.args[5], capabilityValues)
      assert.equal(call.value, parseEther('5'))
    })

    it('should use custom address when provided', () => {
      const pdpOffering = {
        serviceURL: 'https://provider.example.com',
        minPieceSizeInBytes: 1024n,
        maxPieceSizeInBytes: 1073741824n,
        storagePricePerTibPerDay: parseEther('0.1'),
        minProvingPeriodInEpochs: 2880n,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
        ipniPiece: false,
        ipniIpfs: false,
      }

      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = registerProviderCall({
        chain: calibration,
        payee: '0x9876543210987654321098765432109876543210',
        name: 'Test Provider',
        description: 'Test Description',
        productType: 0,
        pdpOffering,
        value: parseEther('5'),
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })

    it('should handle capabilities', () => {
      const pdpOffering = {
        serviceURL: 'https://provider.example.com',
        minPieceSizeInBytes: 1024n,
        maxPieceSizeInBytes: 1073741824n,
        storagePricePerTibPerDay: parseEther('0.1'),
        minProvingPeriodInEpochs: 2880n,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
        ipniPiece: false,
        ipniIpfs: false,
      }
      const capabilities = { region: 'us-east', tier: 'premium' }
      const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering, capabilities)

      const call = registerProviderCall({
        chain: calibration,
        payee: '0x1234567890123456789012345678901234567890',
        name: 'Test Provider',
        description: 'Test Description',
        productType: 0,
        capabilities,
        pdpOffering,
        value: parseEther('5'),
      })

      assert.ok(capabilityKeys.includes('region'))
      assert.ok(capabilityKeys.includes('tier'))
      assert.equal(capabilityKeys.length, capabilityValues.length)
      assert.deepEqual(call.args[4], capabilityKeys)
      assert.deepEqual(call.args[5], capabilityValues)
    })
  })

  describe('registerProvider (with mocked RPC)', () => {
    it('should register provider and return transaction hash', async () => {
      const pdpOffering = {
        serviceURL: 'https://provider.example.com',
        minPieceSizeInBytes: 1024n,
        maxPieceSizeInBytes: 1073741824n,
        storagePricePerTibPerDay: parseEther('0.1'),
        minProvingPeriodInEpochs: 2880n,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
        ipniPiece: false,
        ipniIpfs: false,
      }
      const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering)

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            registerProvider: (args, value) => {
              assert.deepEqual(args, [
                account.address,
                'Test Provider',
                'Test Description',
                0,
                capabilityKeys,
                capabilityValues,
              ])
              assert.equal(hexToBigInt(value), parseEther('5'))
              return [1n] // Return provider ID
            },
          },
        })
      )

      const account = privateKeyToAccount(PRIVATE_KEYS.key1)
      const client = createWalletClient({
        account,
        chain: calibration,
        transport: http(),
      })

      const hash = await registerProvider(client, {
        payee: account.address,
        name: 'Test Provider',
        description: 'Test Description',
        pdpOffering,
      })

      assert.ok(hash.startsWith('0x'))
      assert.equal(hash.length, 66) // 0x + 64 hex chars
    })

    it('should use provided registration fee value', async () => {
      let capturedValue: bigint | undefined
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            registerProvider: (_args, value) => {
              capturedValue = hexToBigInt(value)
              return [2n] // Return provider ID
            },
          },
        })
      )

      const account = privateKeyToAccount(PRIVATE_KEYS.key1)
      const client = createWalletClient({
        account,
        chain: calibration,
        transport: http(),
      })

      const pdpOffering = {
        serviceURL: 'https://provider.example.com',
        minPieceSizeInBytes: 1024n,
        maxPieceSizeInBytes: 1073741824n,
        storagePricePerTibPerDay: parseEther('0.1'),
        minProvingPeriodInEpochs: 2880n,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000' as const,
        ipniPiece: false,
        ipniIpfs: false,
      }

      const customFee = parseEther('10')
      await registerProvider(client, {
        payee: account.address,
        name: 'Test Provider',
        description: 'Test Description',
        pdpOffering,
        value: customFee,
      })

      assert.equal(capturedValue, customFee)
    })
  })
})
