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
  private readonly _provider: ethers.Provider
  private readonly _signer: ethers.Signer
  private readonly _network: 'mainnet' | 'calibration'
  private readonly _disableNonceManager: boolean

  // Cached contract instances
  private _usdfcContract: ethers.Contract | null = null
  private _paymentsContract: ethers.Contract | null = null

  // Static constant for USDFC token identifier
  static readonly USDFC = 'USDFC' as const

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
    let network: 'mainnet' | 'calibration'
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

    return new Synapse(provider, signer, network, options.disableNonceManager === true)
  }

  private constructor (
    provider: ethers.Provider,
    signer: ethers.Signer,
    network: 'mainnet' | 'calibration',
    disableNonceManager: boolean
  ) {
    this._provider = provider
    this._signer = signer
    this._network = network
    this._disableNonceManager = disableNonceManager
  }

  /**
   * Get cached USDFC contract instance or create new one
   */
  private _getUsdfcContract (): ethers.Contract {
    if (this._usdfcContract == null) {
      const usdfcAddress = USDFC_ADDRESSES[this._network]
      if (usdfcAddress == null) {
        throw new Error(`USDFC contract not deployed on ${this._network} network`)
      }
      this._usdfcContract = new ethers.Contract(usdfcAddress, ERC20_ABI, this._signer)
    }
    return this._usdfcContract
  }

  /**
   * Get cached payments contract instance or create new one
   */
  private _getPaymentsContract (): ethers.Contract {
    if (this._paymentsContract == null) {
      const paymentsAddress = PAYMENTS_ADDRESSES[this._network]
      if (paymentsAddress == null) {
        throw new Error(`Payments contract not deployed on ${this._network} network`)
      }
      this._paymentsContract = new ethers.Contract(paymentsAddress, PAYMENTS_ABI, this._signer)
    }
    return this._paymentsContract
  }

  async balance (token: TokenIdentifier = Synapse.USDFC): Promise<bigint> {
    // For now, only support USDFC balance
    if (token !== Synapse.USDFC) {
      throw this._createError(
        'payments contract balance check',
        `Token "${token}" is not supported. Currently only USDFC token is supported for payments contract balance queries.`
      )
    }

    const signerAddress = await this._signer.getAddress()

    const usdfcAddress = USDFC_ADDRESSES[this._network]
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
    // If no token specified or FIL is requested, return native wallet balance
    if (token == null || token === 'FIL') {
      try {
        const address = await this._signer.getAddress()
        const balance = await this._provider.getBalance(address)
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
        const address = await this._signer.getAddress()
        const usdfcContract = this._getUsdfcContract()
        const balance = await usdfcContract.balanceOf(address)
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

    const signerAddress = await this._signer.getAddress()

    const usdfcAddress = USDFC_ADDRESSES[this._network]
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
      if (this._disableNonceManager) {
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
    if (this._disableNonceManager) {
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

    const signerAddress = await this._signer.getAddress()

    const usdfcAddress = USDFC_ADDRESSES[this._network]
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
    if (this._disableNonceManager) {
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
}

// Export as default
export { Synapse as default }
