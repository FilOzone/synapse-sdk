/**
 * EIP-712 Authentication helpers for PDP operations
 */

import { ethers } from 'ethers'
import { type AuthSignature, type RootData } from '../types.js'
import { asCommP, toPieceSize } from '../commp/index.js'

// Declare window.ethereum for TypeScript
declare global {
  interface Window {
    ethereum?: any
  }
}

// EIP-712 Type definitions
const EIP712_TYPES = {
  CreateProofSet: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'withCDN', type: 'bool' },
    { name: 'payee', type: 'address' }
  ],
  Cid: [
    { name: 'data', type: 'bytes' }
  ],
  RootData: [
    { name: 'root', type: 'Cid' },
    { name: 'rawSize', type: 'uint256' }
  ],
  AddRoots: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'firstAdded', type: 'uint256' },
    { name: 'rootData', type: 'RootData[]' }
  ],
  ScheduleRemovals: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'rootIds', type: 'uint256[]' }
  ],
  DeleteProofSet: [
    { name: 'clientDataSetId', type: 'uint256' }
  ]
}

/**
 * Helper class for creating EIP-712 typed signatures for PDP operations
 *
 * This class provides methods to create cryptographic signatures required for
 * authenticating PDP (Proof of Data Possession) operations with storage providers.
 * All signatures are EIP-712 compatible for improved security and UX.
 *
 * Can be used standalone or through the Synapse SDK.
 *
 * @example
 * ```typescript
 * // Direct instantiation with ethers signer
 * import { PDPAuthHelper } from '@filoz/synapse-sdk'
 * import { ethers } from 'ethers'
 *
 * const wallet = new ethers.Wallet(privateKey, provider)
 * const auth = new PDPAuthHelper(contractAddress, wallet, BigInt(chainId))
 *
 * // Or get from Synapse instance (convenience method)
 * const synapse = await Synapse.create({ privateKey, rpcURL })
 * const auth = synapse.getPDPAuthHelper()
 *
 * // Sign operations for PDP service authentication
 * const createSig = await auth.signCreateProofSet(0, providerAddress, false)
 * const addRootsSig = await auth.signAddRoots(0, 1, rootDataArray)
 * ```
 */
export class PDPAuthHelper {
  private readonly signer: ethers.Signer
  private readonly domain: ethers.TypedDataDomain

  constructor (serviceContractAddress: string, signer: ethers.Signer, chainId: bigint) {
    this.signer = signer

    // EIP-712 domain
    this.domain = {
      name: 'PandoraService',
      version: '1',
      chainId: Number(chainId),
      verifyingContract: serviceContractAddress
    }
  }

  /**
   * Get the actual signer, unwrapping NonceManager if needed
   */
  private getUnderlyingSigner (): ethers.Signer {
    // Check if this is a NonceManager-wrapped signer
    if ('signer' in this.signer && this.signer.constructor.name === 'NonceManager') {
      // Access the underlying signer for signTypedData support
      return (this.signer as any).signer
    }
    return this.signer
  }

  /**
   * Check if the signer is a browser provider (MetaMask, etc)
   */
  private async isMetaMaskSigner (): Promise<boolean> {
    try {
      // Get the actual signer (unwrap NonceManager if needed)
      const actualSigner = this.getUnderlyingSigner()

      // If it's a Wallet, it can sign locally, so not a MetaMask signer
      if (actualSigner.constructor.name === 'Wallet') {
        return false
      }

      // Check if signer has a provider
      const provider = actualSigner.provider
      if (provider == null) {
        return false
      }

      // Check for ethers v6 BrowserProvider
      if ('_eip1193Provider' in provider) {
        return true
      }

      // Check for window.ethereum (browser environment)
      if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
        const win = globalThis as any
        if (win.window?.ethereum != null) {
          return true
        }
      }

      // Check for provider with send method
      if ('send' in provider || 'request' in provider) {
        return true
      }
    } catch (error) {
      // Silently fail and return false
    }
    return false
  }

  /**
   * Sign typed data with MetaMask-friendly display
   * This bypasses ethers.js conversion to show human-readable values in MetaMask
   */
  private async signWithMetaMask (
    types: Record<string, Array<{ name: string, type: string }>>,
    value: any
  ): Promise<string> {
    const provider = this.signer.provider
    if (provider == null) {
      throw new Error('No provider available')
    }

    const signerAddress = await this.signer.getAddress()

    // Determine the primary type (the first one that isn't a dependency)
    let primaryType = ''
    for (const typeName of Object.keys(types)) {
      // Skip Cid and RootData as they are dependencies
      if (typeName !== 'Cid' && typeName !== 'RootData') {
        primaryType = typeName
        break
      }
    }

    // Construct the full typed data payload for MetaMask
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' }
        ],
        ...types
      },
      primaryType,
      domain: this.domain,
      message: value
    }

    // For ethers v6, we need to access the underlying EIP-1193 provider
    let eip1193Provider: any
    if ('_eip1193Provider' in provider) {
      // BrowserProvider in ethers v6
      eip1193Provider = (provider as any)._eip1193Provider
    } else if ('request' in provider) {
      // Already an EIP-1193 provider
      eip1193Provider = provider
    } else {
      // Fallback to provider.send
      eip1193Provider = provider
    }

    // Call MetaMask directly for better UX
    let signature: string
    if (eip1193Provider != null && 'request' in eip1193Provider) {
      // Use EIP-1193 request method
      signature = await eip1193Provider.request({
        method: 'eth_signTypedData_v4',
        params: [signerAddress.toLowerCase(), JSON.stringify(typedData)]
      })
    } else {
      // Fallback to send method
      signature = await (provider as any).send('eth_signTypedData_v4', [
        signerAddress.toLowerCase(),
        JSON.stringify(typedData)
      ])
    }

    return signature
  }

  /**
   * Create signature for proof set creation
   *
   * This signature authorizes a storage provider to create a new proof set
   * on behalf of the client. The signature includes the client's dataset ID,
   * the storage provider's payment address, and CDN preference.
   *
   * @param clientDataSetId - Unique dataset ID for the client (typically starts at 0 and increments)
   * @param payee - Storage provider's address that will receive payments
   * @param withCDN - Whether to enable CDN service for faster retrieval (default: false)
   * @returns Promise resolving to authentication signature for proof set creation
   *
   * @example
   * ```typescript
   * const auth = new PDPAuthHelper(contractAddress, signer, chainId)
   * const signature = await auth.signCreateProofSet(
   *   0,                              // First dataset for this client
   *   '0x1234...abcd',               // Storage provider address
   *   true                           // Enable CDN service
   * )
   * ```
   */
  async signCreateProofSet (
    clientDataSetId: number | bigint,
    payee: string,
    withCDN: boolean = false
  ): Promise<AuthSignature> {
    let signature: string

    // Check if we should use MetaMask-friendly signing
    const useMetaMask = await this.isMetaMaskSigner()

    if (useMetaMask) {
      // Use MetaMask-friendly signing for better UX
      const value = {
        clientDataSetId: clientDataSetId.toString(), // Keep as string for MetaMask display
        withCDN,
        payee
      }

      signature = await this.signWithMetaMask(
        { CreateProofSet: EIP712_TYPES.CreateProofSet },
        value
      )
    } else {
      // Use standard ethers.js signing (for private keys, etc)
      const value = {
        clientDataSetId: BigInt(clientDataSetId),
        withCDN,
        payee
      }

      // Use underlying signer for typed data signing (handles NonceManager)
      const actualSigner = this.getUnderlyingSigner()
      signature = await actualSigner.signTypedData(
        this.domain,
        { CreateProofSet: EIP712_TYPES.CreateProofSet },
        value
      )
    }

    // Return signature with components
    const sig = ethers.Signature.from(signature)

    // For EIP-712, signedData contains the actual message hash that was signed
    const signedData = ethers.TypedDataEncoder.hash(
      this.domain,
      { CreateProofSet: EIP712_TYPES.CreateProofSet },
      {
        clientDataSetId: BigInt(clientDataSetId),
        withCDN,
        payee
      }
    )

    return {
      signature,
      v: sig.v,
      r: sig.r,
      s: sig.s,
      signedData
    }
  }

  /**
   * Create signature for adding roots to a proof set
   *
   * This signature authorizes a storage provider to add new data roots
   * to an existing proof set. Each root represents aggregated data that
   * will be proven using PDP challenges.
   *
   * @param clientDataSetId - Client's dataset ID (same as used in createProofSet)
   * @param firstRootId - ID of the first root being added (sequential numbering)
   * @param rootDataArray - Array of root data containing CommP CIDs and raw sizes
   * @returns Promise resolving to authentication signature for adding roots
   *
   * @example
   * ```typescript
   * const auth = new PDPAuthHelper(contractAddress, signer, chainId)
   * const rootData = [{
   *   cid: 'baga6ea4seaqai...', // CommP CID of aggregated data
   *   rawSize: 1024 * 1024     // Raw size in bytes before padding
   * }]
   * const signature = await auth.signAddRoots(
   *   0,           // Same dataset ID as proof set creation
   *   1,           // First root has ID 1 (0 reserved)
   *   rootData     // Array of roots to add
   * )
   * ```
   */
  async signAddRoots (
    clientDataSetId: number | bigint,
    firstRootId: number | bigint,
    rootDataArray: RootData[]
  ): Promise<AuthSignature> {
    // Transform the root data into the proper format for EIP-712
    const formattedRootData = []
    for (const root of rootDataArray) {
      const commP = typeof root.cid === 'string' ? asCommP(root.cid) : root.cid
      if (commP == null) {
        throw new Error(`Invalid CommP: ${String(root.cid)}`)
      }

      // Format as nested structure matching Solidity's Cids.Cid struct
      formattedRootData.push({
        root: {
          data: commP.bytes // This will be a Uint8Array
        },
        rawSize: BigInt(toPieceSize(root.rawSize))
      })
    }

    let signature: string

    // Check if we should use MetaMask-friendly signing
    const useMetaMask = await this.isMetaMaskSigner()

    if (useMetaMask) {
      // Use MetaMask-friendly signing with properly structured data
      const value = {
        clientDataSetId: clientDataSetId.toString(), // Keep as string for MetaMask display
        firstAdded: firstRootId.toString(), // Keep as string for MetaMask display
        rootData: formattedRootData.map(item => ({
          root: {
            data: ethers.hexlify(item.root.data) // Convert Uint8Array to hex string for MetaMask
          },
          rawSize: item.rawSize.toString() // Keep as string for MetaMask display
        }))
      }

      // Define the complete type structure
      const types = {
        AddRoots: EIP712_TYPES.AddRoots,
        RootData: EIP712_TYPES.RootData,
        Cid: EIP712_TYPES.Cid
      }

      signature = await this.signWithMetaMask(types, value)
    } else {
      // Use standard ethers.js signing with bigint values
      const value = {
        clientDataSetId: BigInt(clientDataSetId),
        firstAdded: BigInt(firstRootId),
        rootData: formattedRootData
      }

      // Define the complete type structure
      const types = {
        AddRoots: EIP712_TYPES.AddRoots,
        RootData: EIP712_TYPES.RootData,
        Cid: EIP712_TYPES.Cid
      }

      // Use underlying signer for typed data signing (handles NonceManager)
      const actualSigner = this.getUnderlyingSigner()
      signature = await actualSigner.signTypedData(this.domain, types, value)
    }

    // Return signature with components
    const sig = ethers.Signature.from(signature)

    // For EIP-712, signedData contains the actual message hash that was signed
    const signedData = ethers.TypedDataEncoder.hash(
      this.domain,
      {
        AddRoots: EIP712_TYPES.AddRoots,
        RootData: EIP712_TYPES.RootData,
        Cid: EIP712_TYPES.Cid
      },
      {
        clientDataSetId: BigInt(clientDataSetId),
        firstAdded: BigInt(firstRootId),
        rootData: formattedRootData
      }
    )

    return {
      signature,
      v: sig.v,
      r: sig.r,
      s: sig.s,
      signedData
    }
  }

  /**
   * Create signature for scheduling root removals
   *
   * This signature authorizes a storage provider to schedule specific roots
   * for removal from the proof set. Roots are typically removed after the
   * next successful proof submission.
   *
   * @param clientDataSetId - Client's dataset ID
   * @param rootIds - Array of root IDs to schedule for removal
   * @returns Promise resolving to authentication signature for scheduling removals
   *
   * @example
   * ```typescript
   * const auth = new PDPAuthHelper(contractAddress, signer, chainId)
   * const signature = await auth.signScheduleRemovals(
   *   0,           // Dataset ID
   *   [1, 2, 3]    // Root IDs to remove
   * )
   * ```
   */
  async signScheduleRemovals (
    clientDataSetId: number | bigint,
    rootIds: Array<number | bigint>
  ): Promise<AuthSignature> {
    // Convert rootIds to BigInt array for proper encoding
    const rootIdsBigInt = rootIds.map(id => BigInt(id))

    let signature: string

    // Check if we should use MetaMask-friendly signing
    const useMetaMask = await this.isMetaMaskSigner()

    if (useMetaMask) {
      // Use MetaMask-friendly signing for better UX
      const value = {
        clientDataSetId: clientDataSetId.toString(), // Keep as string for MetaMask display
        rootIds: rootIdsBigInt.map(id => id.toString()) // Convert to string array for display
      }

      signature = await this.signWithMetaMask(
        { ScheduleRemovals: EIP712_TYPES.ScheduleRemovals },
        value
      )
    } else {
      // Use standard ethers.js signing with BigInt values
      const value = {
        clientDataSetId: BigInt(clientDataSetId),
        rootIds: rootIdsBigInt
      }

      // Use underlying signer for typed data signing (handles NonceManager)
      const actualSigner = this.getUnderlyingSigner()
      signature = await actualSigner.signTypedData(
        this.domain,
        { ScheduleRemovals: EIP712_TYPES.ScheduleRemovals },
        value
      )
    }

    const sig = ethers.Signature.from(signature)

    // For EIP-712, signedData contains the actual message hash that was signed
    const signedData = ethers.TypedDataEncoder.hash(
      this.domain,
      { ScheduleRemovals: EIP712_TYPES.ScheduleRemovals },
      {
        clientDataSetId: BigInt(clientDataSetId),
        rootIds: rootIdsBigInt
      }
    )

    return {
      signature,
      v: sig.v,
      r: sig.r,
      s: sig.s,
      signedData
    }
  }

  /**
   * Create signature for proof set deletion
   *
   * This signature authorizes complete deletion of a proof set and all
   * its associated data. This action is irreversible and will terminate
   * the storage service for this dataset.
   *
   * @param clientDataSetId - Client's dataset ID to delete
   * @returns Promise resolving to authentication signature for proof set deletion
   *
   * @example
   * ```typescript
   * const auth = new PDPAuthHelper(contractAddress, signer, chainId)
   * const signature = await auth.signDeleteProofSet(
   *   0  // Dataset ID to delete
   * )
   * ```
   */
  async signDeleteProofSet (
    clientDataSetId: number | bigint
  ): Promise<AuthSignature> {
    let signature: string

    // Check if we should use MetaMask-friendly signing
    const useMetaMask = await this.isMetaMaskSigner()

    if (useMetaMask) {
      // Use MetaMask-friendly signing for better UX
      const value = {
        clientDataSetId: clientDataSetId.toString() // Keep as string for MetaMask display
      }

      signature = await this.signWithMetaMask(
        { DeleteProofSet: EIP712_TYPES.DeleteProofSet },
        value
      )
    } else {
      // Use standard ethers.js signing
      const value = {
        clientDataSetId: BigInt(clientDataSetId)
      }

      // Use underlying signer for typed data signing (handles NonceManager)
      const actualSigner = this.getUnderlyingSigner()
      signature = await actualSigner.signTypedData(
        this.domain,
        { DeleteProofSet: EIP712_TYPES.DeleteProofSet },
        value
      )
    }

    const sig = ethers.Signature.from(signature)

    // For EIP-712, signedData contains the actual message hash that was signed
    const signedData = ethers.TypedDataEncoder.hash(
      this.domain,
      { DeleteProofSet: EIP712_TYPES.DeleteProofSet },
      {
        clientDataSetId: BigInt(clientDataSetId)
      }
    )

    return {
      signature,
      v: sig.v,
      r: sig.r,
      s: sig.s,
      signedData
    }
  }

  /**
   * Get the address of the signer
   * @returns Promise resolving to the signer's Ethereum address
   */
  async getSignerAddress (): Promise<string> {
    return await this.signer.getAddress()
  }
}
