/**
 * Main Synapse class for interacting with Filecoin storage and other on-chain services
 */

import { ethers } from 'ethers'
import type {
  Synapse as ISynapse,
  SynapseOptions,
  StorageOptions,
  TokenAmount,
  TokenIdentifier
} from './types.js'
import { MockStorageService } from './storage-service.js'
import {
  USDFC_ADDRESSES,
  CHAIN_IDS,
  ERC20_ABI,
  PAYMENTS_ADDRESSES,
  PAYMENTS_ABI
} from './constants.js'

export class Synapse implements ISynapse {
  private readonly _options: SynapseOptions
  private readonly _provider: ethers.Provider
  private _signer: ethers.Signer | null = null
  private _network: 'mainnet' | 'calibration' | null = null
  private readonly _networkPromise: Promise<void>

  // Cached contract instances
  private _usdfcContract: ethers.Contract | null = null
  private _paymentsContract: ethers.Contract | null = null

  /**
   * Helper to create descriptive errors with context
   */
  private _createError (operation: string, details: string, originalError?: unknown): Error {
    const baseMessage = `Synapse ${operation} failed: ${details}`

    if (originalError != null) {
      return new Error(baseMessage, { cause: originalError })
    }

    return new Error(baseMessage)
  }

  // Static constant for USDFC token identifier
  static readonly USDFC = 'USDFC' as const

  /**
   * Create a new Synapse instance with async initialization
   * This is the preferred way to create a Synapse instance
   * @param options - Configuration options for Synapse
   * @returns A fully initialized Synapse instance
   */
  static async create (options: SynapseOptions): Promise<Synapse> {
    const synapse = new Synapse(options)
    // Wait for all async initialization to complete
    await synapse._networkPromise
    return synapse
  }

  constructor (options: SynapseOptions) {
    // Count how many options are provided
    const providedOptions = [options.privateKey, options.provider, options.signer].filter(Boolean).length

    if (providedOptions !== 1) {
      throw new Error('Must provide exactly one of: privateKey, provider, or signer')
    }

    if (options.privateKey != null && options.rpcURL == null) {
      throw new Error('rpcURL is required when using privateKey')
    }

    this._options = options

    if (options.privateKey != null && options.rpcURL != null) {
      // Server environment: create provider and wallet from private key
      // Check if rpcURL is a WebSocket URL
      const rpcURL = options.rpcURL
      if (rpcURL.startsWith('ws://') || rpcURL.startsWith('wss://')) {
        this._provider = new ethers.WebSocketProvider(rpcURL)
      } else {
        this._provider = new ethers.JsonRpcProvider(rpcURL)
      }
      const wallet = new ethers.Wallet(options.privateKey, this._provider)

      // Apply NonceManager if not disabled
      if (options.disableNonceManager !== true) {
        this._signer = new ethers.NonceManager(wallet)
      } else {
        this._signer = wallet
      }
    } else if (options.provider != null) {
      // Browser environment: use provided provider
      this._provider = options.provider
      // Signer will be initialized during async initialization
    } else if (options.signer != null) {
      // Legacy interface: use signer and its provider
      this._signer = options.signer
      if (options.signer.provider != null) {
        this._provider = options.signer.provider
      } else {
        throw new Error('Signer must have a provider attached')
      }

      // Use NonceManager by default unless explicitly disabled
      if (options.disableNonceManager !== true) {
        this._signer = new ethers.NonceManager(this._signer)
      }
    } else {
      throw new Error('Invalid configuration')
    }

    // Initialize async operations
    this._networkPromise = this._initialize()
  }

  /**
   * Perform all async initialization
   */
  private async _initialize (): Promise<void> {
    await Promise.all([
      this._detectNetwork(), // Detect network from chain ID
      this._initializeSigner() // Initialize signer if using provider
    ])
  }

  /**
   * Initialize signer from provider if needed
   */
  private async _initializeSigner (): Promise<void> {
    if (this._signer == null && this._options.provider != null) {
      // Initialize signer from provider for browser environment
      if ('getSigner' in this._provider && typeof this._provider.getSigner === 'function') {
        const signer = await (this._provider as any).getSigner()

        // Apply NonceManager if not disabled
        if (this._options.disableNonceManager !== true) {
          this._signer = new ethers.NonceManager(signer)
        } else {
          this._signer = signer
        }
      } else {
        throw new Error('Provider must support getSigner() method')
      }
    }
  }

  /**
   * Get the signer, throwing if not initialized
   */
  private _getSigner (): ethers.Signer {
    if (this._signer == null) {
      throw new Error(
        'Signer not initialized. This should not happen after network detection and initialization.'
      )
    }
    return this._signer
  }

  /**
   * Get cached USDFC contract instance or create new one
   */
  private _getUsdfcContract (): ethers.Contract {
    if (this._usdfcContract == null) {
      // Network is guaranteed to be set when this is called after await _networkPromise
      const network = this._network as 'mainnet' | 'calibration'
      const usdfcAddress = USDFC_ADDRESSES[network]
      if (usdfcAddress == null) {
        throw new Error(`USDFC contract not deployed on ${network} network`)
      }
      const signer = this._getSigner()
      this._usdfcContract = new ethers.Contract(usdfcAddress, ERC20_ABI, signer)
    }
    return this._usdfcContract
  }

  /**
   * Get cached payments contract instance or create new one
   */
  private _getPaymentsContract (): ethers.Contract {
    if (this._paymentsContract == null) {
      // Network is guaranteed to be set when this is called after await _networkPromise
      const network = this._network as 'mainnet' | 'calibration'
      const paymentsAddress = PAYMENTS_ADDRESSES[network]
      if (paymentsAddress == null) {
        throw new Error(`Payments contract not deployed on ${network} network`)
      }
      const signer = this._getSigner()
      this._paymentsContract = new ethers.Contract(paymentsAddress, PAYMENTS_ABI, signer)
    }
    return this._paymentsContract
  }

  private async _detectNetwork (): Promise<void> {
    // Try to get network info from provider
    let network: ethers.Network
    try {
      network = await this._provider.getNetwork()
    } catch (error) {
      throw this._createError(
        'network detection',
        'Failed to detect network from provider. Please ensure your RPC endpoint is accessible and responds to network queries.',
        error
      )
    }

    // Validate the network is supported
    const chainId = Number(network.chainId)
    if (chainId === CHAIN_IDS.mainnet) {
      this._network = 'mainnet'
    } else if (chainId === CHAIN_IDS.calibration) {
      this._network = 'calibration'
    } else {
      throw this._createError(
        'network detection',
        `Unsupported network with chain ID ${chainId}. Synapse SDK only supports Filecoin mainnet (${CHAIN_IDS.mainnet}) and calibration (${CHAIN_IDS.calibration}) networks.`
      )
    }
  }

  async balance (token: TokenIdentifier = Synapse.USDFC): Promise<bigint> {
    // For now, only support USDFC balance
    if (token !== Synapse.USDFC) {
      throw this._createError(
        'payments contract balance check',
        `Token "${token}" is not supported. Currently only USDFC token is supported for payments contract balance queries.`
      )
    }

    // Ensure network is detected
    await this._networkPromise

    if (this._network == null) {
      throw this._createError('balance', 'Network detection failed')
    }

    // Get contract addresses for current network
    const usdfcAddress = USDFC_ADDRESSES[this._network]

    // Get signer address
    const signerAddress = await this._getSigner().getAddress()

    const paymentsContract = this._getPaymentsContract()

    let accountInfo: any[]

    try {
      // Get account info from payments contract
      accountInfo = await paymentsContract.accounts(usdfcAddress, signerAddress)
    } catch (contractCallError) {
      throw this._createError(
        'payments contract balance check',
        'Failed to read account information from payments contract. This could indicate the contract is not properly deployed, the ABI is incorrect, or there are network connectivity issues.',
        contractCallError
      )
    }

    // accountInfo returns: (uint256 funds, uint256 lockedFunds, bool frozen)
    const [funds, lockedFunds] = accountInfo

    // Return the available funds (total funds - locked funds) as bigint
    const availableFunds = BigInt(funds) - BigInt(lockedFunds)

    return availableFunds
  }

  async walletBalance (token?: TokenIdentifier): Promise<bigint> {
    // Ensure network is detected before proceeding
    await this._networkPromise

    // If no token specified or FIL is requested, return native wallet balance
    if (token == null || token === 'FIL') {
      try {
        // Get the signer's address
        const address = await this._getSigner().getAddress()

        // Get the actual balance from the blockchain
        const balance = await this._provider.getBalance(address)

        // Return balance as bigint (in smallest unit)
        return balance
      } catch (error) {
        throw this._createError(
          'wallet FIL balance check',
          'Unable to retrieve FIL balance from wallet. This could be due to network connectivity issues, RPC endpoint problems, or wallet connection issues.',
          error
        )
      }
    }

    // Handle ERC20 token balance
    if (token === 'USDFC' || token === Synapse.USDFC) {
      try {
        // Get the signer's address
        const address = await this._getSigner().getAddress()

        const usdfcContract = this._getUsdfcContract()

        const balance = await usdfcContract.balanceOf(address)

        // Return balance as bigint (in smallest unit)
        return balance
      } catch (error) {
        throw this._createError(
          'wallet USDFC balance check',
          'Unexpected error while checking USDFC token balance in wallet.',
          error
        )
      }
    }

    // For other tokens, could add support later
    throw this._createError(
      'wallet balance check',
      `Token "${token}" is not supported. Currently only USDFC token is supported for balance queries.`
    )
  }

  decimals (token: TokenIdentifier = Synapse.USDFC): number {
    // Both FIL and USDFC use 18 decimals
    return 18
  }

  async deposit (amount: TokenAmount, token: TokenIdentifier = Synapse.USDFC): Promise<string> {
    // Only support USDFC for now
    if (token !== 'USDFC' && token !== Synapse.USDFC) {
      throw this._createError('deposit', `Unsupported token: ${token}`)
    }

    const depositAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)

    if (depositAmountBigint <= 0n) {
      throw this._createError('deposit', 'Invalid amount')
    }

    await this._networkPromise

    if (this._network == null) {
      throw this._createError('deposit', 'Network detection failed')
    }

    const usdfcAddress = USDFC_ADDRESSES[this._network]

    const signer = this._getSigner()
    const signerAddress = await signer.getAddress()

    const usdfcContract = this._getUsdfcContract()
    const paymentsContract = this._getPaymentsContract()

    // Check balance
    const usdfcBalance = await usdfcContract.balanceOf(signerAddress)

    if (usdfcBalance < depositAmountBigint) {
      throw this._createError(
        'deposit',
        `Insufficient USDFC: have ${BigInt(
          usdfcBalance
        ).toString()}, need ${depositAmountBigint.toString()}`
      )
    }

    // Check and update allowance if needed
    const paymentsAddress = PAYMENTS_ADDRESSES[this._network]
    if (paymentsAddress == null) {
      throw this._createError('deposit', `Payments contract not deployed on ${this._network}`)
    }
    const currentAllowance = await usdfcContract.allowance(signerAddress, paymentsAddress)

    if (currentAllowance < depositAmountBigint) {
      // Only set explicit nonce if NonceManager is disabled
      const txOptions: any = {}
      if (this._options.disableNonceManager === true) {
        const approvalNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
        txOptions.nonce = approvalNonce
      }

      // TODO: Consider refactoring this section out so it can be called separately by the user
      // if they want to control the multi-transaction flow
      const approveTx = await usdfcContract.approve(paymentsAddress, depositAmountBigint, txOptions)
      await approveTx.wait()
    }

    // Check if account is frozen
    const accountInfo = await paymentsContract.accounts(usdfcAddress, signerAddress)
    const [, , frozen] = accountInfo

    if (frozen === true) {
      throw this._createError('deposit', 'Account is frozen')
    }

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._options.disableNonceManager === true) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    const depositTx = await paymentsContract.deposit(
      usdfcAddress,
      signerAddress,
      depositAmountBigint,
      txOptions
    )
    await depositTx.wait()

    return depositTx.hash
  }

  async withdraw (amount: TokenAmount, token: TokenIdentifier = Synapse.USDFC): Promise<string> {
    // Only support USDFC for now
    if (token !== 'USDFC' && token !== Synapse.USDFC) {
      throw this._createError('withdraw', `Unsupported token: ${token}`)
    }

    const withdrawAmountBigint = typeof amount === 'bigint' ? amount : BigInt(amount)

    if (withdrawAmountBigint <= 0n) {
      throw this._createError('withdraw', 'Invalid amount')
    }

    await this._networkPromise

    if (this._network == null) {
      throw this._createError('withdraw', 'Network detection failed')
    }

    const usdfcAddress = USDFC_ADDRESSES[this._network]

    const signer = this._getSigner()
    const signerAddress = await signer.getAddress()

    const paymentsContract = this._getPaymentsContract()

    // Check balance
    const accountInfo = await paymentsContract.accounts(usdfcAddress, signerAddress)

    const [funds, lockedFunds, frozen] = accountInfo
    const availableFunds = BigInt(funds) - BigInt(lockedFunds)

    if (frozen === true) {
      throw this._createError('withdraw', 'Account is frozen')
    }

    if (availableFunds < withdrawAmountBigint) {
      throw this._createError(
        'withdraw',
        `Insufficient balance: have ${availableFunds.toString()}, need ${withdrawAmountBigint.toString()}`
      )
    }

    // Only set explicit nonce if NonceManager is disabled
    const txOptions: any = {}
    if (this._options.disableNonceManager === true) {
      const currentNonce = await this._provider.getTransactionCount(signerAddress, 'pending')
      txOptions.nonce = currentNonce
    }

    const withdrawTx = await paymentsContract.withdraw(usdfcAddress, withdrawAmountBigint, txOptions)
    await withdrawTx.wait()

    return withdrawTx.hash
  }

  async createStorage (options?: StorageOptions): Promise<MockStorageService> {
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

    return new MockStorageService(proofSetId, storageProvider)
  }
}

// Export as default
export { Synapse as default }
