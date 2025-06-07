/**
 * Main Synapse class for interacting with Filecoin storage and other on-chain services
 */

import { ethers } from 'ethers'
import {
  type SynapseOptions,
  type StorageOptions,
  type StorageService,
  type FilecoinNetworkType
} from './types.js'
import { MockStorageService } from './storage-service.js'
import { PaymentsService } from './payments/index.js'
import { CHAIN_IDS } from './utils/index.js'

export class Synapse {
  private readonly _signer: ethers.Signer
  private readonly _network: FilecoinNetworkType
  private readonly _withCDN: boolean
  private readonly _payments: PaymentsService

  /**
   * Create a new Synapse instance with async initialization.
   * @param options - Configuration options for Synapse
   * @returns A fully initialized Synapse instance
   */
  static async create (options: SynapseOptions): Promise<Synapse> {
    // Validate options
    const providedOptions = [options.privateKey, options.provider, options.signer].filter(Boolean).length
    if (providedOptions !== 1) {
      throw new Error('Must provide exactly one of: privateKey, provider, or signer')
    }
    if (options.privateKey != null && options.rpcURL == null) {
      throw new Error('rpcURL is required when using privateKey')
    }

    // Initialize provider and signer
    let provider: ethers.Provider
    let signer: ethers.Signer

    if (options.privateKey != null && options.rpcURL != null) {
      // Create provider from RPC URL
      if (options.rpcURL.startsWith('ws://') || options.rpcURL.startsWith('wss://')) {
        provider = new ethers.WebSocketProvider(options.rpcURL)
      } else {
        // For HTTP/HTTPS URLs, check if authorization is provided
        if (options.authorization != null) {
          const fetchRequest = new ethers.FetchRequest(options.rpcURL)
          fetchRequest.setHeader('Authorization', options.authorization)
          provider = new ethers.JsonRpcProvider(fetchRequest)
        } else {
          provider = new ethers.JsonRpcProvider(options.rpcURL)
        }
      }

      // Create wallet from private key
      const wallet = new ethers.Wallet(options.privateKey, provider)

      // Apply NonceManager if not disabled
      if (options.disableNonceManager !== true) {
        signer = new ethers.NonceManager(wallet)
      } else {
        signer = wallet
      }
    } else if (options.provider != null) {
      provider = options.provider

      // Get signer from provider
      if ('getSigner' in provider && typeof provider.getSigner === 'function') {
        const providerSigner = await (provider as any).getSigner()

        // Apply NonceManager if not disabled
        if (options.disableNonceManager !== true) {
          signer = new ethers.NonceManager(providerSigner)
        } else {
          signer = providerSigner
        }
      } else {
        throw new Error('Provider must support getSigner() method')
      }
    } else if (options.signer != null) {
      signer = options.signer

      if (signer.provider != null) {
        provider = signer.provider
      } else {
        throw new Error('Signer must have a provider attached')
      }

      // Apply NonceManager if not disabled
      if (options.disableNonceManager !== true) {
        signer = new ethers.NonceManager(signer)
      }
    } else {
      throw new Error('Invalid configuration')
    }

    // Detect network
    let network: FilecoinNetworkType
    try {
      const ethersNetwork = await provider.getNetwork()
      const chainId = Number(ethersNetwork.chainId)

      if (chainId === CHAIN_IDS.mainnet) {
        network = 'mainnet'
      } else if (chainId === CHAIN_IDS.calibration) {
        network = 'calibration'
      } else {
        throw new Error(
          `Unsupported network with chain ID ${chainId}. Synapse SDK only supports Filecoin mainnet (${CHAIN_IDS.mainnet}) and calibration (${CHAIN_IDS.calibration}) networks.`
        )
      }
    } catch (error) {
      throw new Error(
        `Failed to detect network from provider. Please ensure your RPC endpoint is accessible and responds to network queries. ${
          error instanceof Error ? `Underlying error: ${error.message}` : ''
        }`
      )
    }

    return new Synapse(provider, signer, network, options.disableNonceManager === true, options.withCDN === true)
  }

  private constructor (
    provider: ethers.Provider,
    signer: ethers.Signer,
    network: FilecoinNetworkType,
    disableNonceManager: boolean,
    withCDN: boolean
  ) {
    this._signer = signer
    this._network = network
    this._withCDN = withCDN
    this._payments = new PaymentsService(provider, signer, network, disableNonceManager)
  }

  /**
   * Get the payments instance for payment operations
   * @returns The PaymentsService instance
   */
  get payments (): PaymentsService {
    return this._payments
  }

  async createStorage (options?: StorageOptions): Promise<StorageService> {
    console.log('[MockSynapse] Creating storage service...')
    console.log('[MockSynapse] Options:', options)

    // Simulate network delay
    console.log('[MockSynapse] Simulating network delay (500ms)...')
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Generate mock proof set ID if not provided
    const proofSetId = options?.proofSetId ?? 'ps_' + Math.random().toString(36).substring(2, 15)

    // Use provided SP or default mock
    const storageProvider = options?.storageProvider ?? 'f01234'

    console.log(
      `[MockSynapse] Storage service created with proofSetId: ${proofSetId}, SP: ${storageProvider}`
    )
    console.log('[MockSynapse] Storage service ready for operations')

    return new MockStorageService(proofSetId, storageProvider, await this._signer.getAddress(), this._withCDN)
  }
}

// Export as default
export { Synapse as default }
