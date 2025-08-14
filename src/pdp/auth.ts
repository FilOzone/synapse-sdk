/**
 * EIP-712 Authentication helpers for PDP operations
 */

import { ethers } from 'ethers'
import { type AuthSignature, type PieceData } from '../types.js'
import { asPieceCID } from '../piece/index.js'

// Declare window.ethereum for TypeScript
declare global {
  interface Window {
    ethereum?: any
  }
}

// EIP-712 Type definitions
const EIP712_TYPES = {
  CreateDataSet: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'withCDN', type: 'bool' },
    { name: 'payee', type: 'address' }
  ],
  Cid: [
    { name: 'data', type: 'bytes' }
  ],
  AddPieces: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'firstAdded', type: 'uint256' },
    { name: 'pieceData', type: 'Cid[]' }
  ],
  SchedulePieceRemovals: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'pieceIds', type: 'uint256[]' }
  ],
  DeleteDataSet: [
    { name: 'clientDataSetId', type: 'uint256' }
  ]
}

/**
 * Helper class for creating EIP-712 typed signatures for PDP operations
 *
 * This class provides methods to create cryptographic signatures required for
 * authenticating PDP (Proof of Data Possession) operations with service providers.
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
 * const createSig = await auth.signCreateDataSet(0, providerAddress, false)
 * const addPiecesSig = await auth.signAddPieces(0, 1, pieceDataArray)
 * ```
 */
export class PDPAuthHelper {
  private readonly signer: ethers.Signer
  private readonly domain: ethers.TypedDataDomain

  constructor (serviceContractAddress: string, signer: ethers.Signer, chainId: bigint) {
    this.signer = signer

    // EIP-712 domain
    this.domain = {
      name: 'FilecoinWarmStorageService',
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
      // Skip Cid and PieceData as they are dependencies
      if (typeName !== 'Cid' && typeName !== 'PieceData') {
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
   * Create signature for data set creation
   *
   * This signature authorizes a service provider to create a new data set
   * on behalf of the client. The signature includes the client's dataset ID,
   * the service provider's payment address, and CDN preference.
   *
   * @param clientDataSetId - Unique dataset ID for the client (typically starts at 0 and increments)
   * @param payee - Service provider's address that will receive payments
   * @param withCDN - Whether to enable CDN service for faster retrieval (default: false)
   * @returns Promise resolving to authentication signature for data set creation
   *
   * @example
   * ```typescript
   * const auth = new PDPAuthHelper(contractAddress, signer, chainId)
   * const signature = await auth.signCreateDataSet(
   *   0,                              // First dataset for this client
   *   '0x1234...abcd',               // Service provider address
   *   true                           // Enable CDN service
   * )
   * ```
   */
  async signCreateDataSet (
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
        { CreateDataSet: EIP712_TYPES.CreateDataSet },
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
        { CreateDataSet: EIP712_TYPES.CreateDataSet },
        value
      )
    }

    // Return signature with components
    const sig = ethers.Signature.from(signature)

    // For EIP-712, signedData contains the actual message hash that was signed
    const signedData = ethers.TypedDataEncoder.hash(
      this.domain,
      { CreateDataSet: EIP712_TYPES.CreateDataSet },
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
   * Create signature for adding pieces to a data set
   *
   * This signature authorizes a service provider to add new data pieces
   * to an existing data set. Each piece represents aggregated data that
   * will be proven using PDP challenges.
   *
   * @param clientDataSetId - Client's dataset ID (same as used in createDataSet)
   * @param firstPieceId - ID of the first piece being added (sequential numbering)
   * @param pieceDataArray - Array of piece data containing PieceCID CIDs and raw sizes
   * @returns Promise resolving to authentication signature for adding pieces
   *
   * @example
   * ```typescript
   * const auth = new PDPAuthHelper(contractAddress, signer, chainId)
   * const pieceData = [{
   *   cid: 'bafkzcibc...', // PieceCID of aggregated data
   *   rawSize: 1024 * 1024     // Raw size in bytes before padding
   * }]
   * const signature = await auth.signAddPieces(
   *   0,           // Same dataset ID as data set creation
   *   1,           // First piece has ID 1 (0 reserved)
   *   pieceData    // Array of pieces to add
   * )
   * ```
   */
  async signAddPieces (
    clientDataSetId: number | bigint,
    firstPieceId: number | bigint,
    pieceDataArray: PieceData[]
  ): Promise<AuthSignature> {
    // Transform the piece data into the proper format for EIP-712
    const formattedPieceData = []
    for (const piece of pieceDataArray) {
      // TODO(CIDv2): support PieceCIDv2 in asPieceCID
      const pieceCid = typeof piece.cid === 'string' ? asPieceCID(piece.cid) : piece.cid
      if (pieceCid == null) {
        throw new Error(`Invalid PieceCID: ${String(piece.cid)}`)
      }

      // Format as nested structure matching Solidity's Cids.Cid struct
      formattedPieceData.push({
        data: pieceCid.bytes // This will be a Uint8Array
      })
    }

    let signature: string

    // Check if we should use MetaMask-friendly signing
    const useMetaMask = await this.isMetaMaskSigner()

    if (useMetaMask) {
      // Use MetaMask-friendly signing with properly structured data
      const value = {
        clientDataSetId: clientDataSetId.toString(), // Keep as string for MetaMask display
        firstAdded: firstPieceId.toString(), // Keep as string for MetaMask display
        pieceData: formattedPieceData.map(item => ({
          data: ethers.hexlify(item.data) // Convert Uint8Array to hex string for MetaMask
        }))
      }

      // Define the complete type structure
      const types = {
        AddPieces: EIP712_TYPES.AddPieces,
        Cid: EIP712_TYPES.Cid
      }

      signature = await this.signWithMetaMask(types, value)
    } else {
      // Use standard ethers.js signing with bigint values
      const value = {
        clientDataSetId: BigInt(clientDataSetId),
        firstAdded: BigInt(firstPieceId),
        pieceData: formattedPieceData
      }

      // Define the complete type structure
      const types = {
        AddPieces: EIP712_TYPES.AddPieces,
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
        AddPieces: EIP712_TYPES.AddPieces,
        Cid: EIP712_TYPES.Cid
      },
      {
        clientDataSetId: BigInt(clientDataSetId),
        firstAdded: BigInt(firstPieceId),
        pieceData: formattedPieceData
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
   * Create signature for scheduling piece removals
   *
   * This signature authorizes a service provider to schedule specific pieces
   * for removal from the data set. Pieces are typically removed after the
   * next successful proof submission.
   *
   * @param clientDataSetId - Client's dataset ID
   * @param pieceIds - Array of piece IDs to schedule for removal
   * @returns Promise resolving to authentication signature for scheduling removals
   *
   * @example
   * ```typescript
   * const auth = new PDPAuthHelper(contractAddress, signer, chainId)
   * const signature = await auth.signSchedulePieceRemovals(
   *   0,           // Dataset ID
   *   [1, 2, 3]    // Piece IDs to remove
   * )
   * ```
   */
  async signSchedulePieceRemovals (
    clientDataSetId: number | bigint,
    pieceIds: Array<number | bigint>
  ): Promise<AuthSignature> {
    // Convert pieceIds to BigInt array for proper encoding
    const pieceIdsBigInt = pieceIds.map(id => BigInt(id))

    let signature: string

    // Check if we should use MetaMask-friendly signing
    const useMetaMask = await this.isMetaMaskSigner()

    if (useMetaMask) {
      // Use MetaMask-friendly signing for better UX
      const value = {
        clientDataSetId: clientDataSetId.toString(), // Keep as string for MetaMask display
        pieceIds: pieceIdsBigInt.map(id => id.toString()) // Convert to string array for display
      }

      signature = await this.signWithMetaMask(
        { SchedulePieceRemovals: EIP712_TYPES.SchedulePieceRemovals },
        value
      )
    } else {
      // Use standard ethers.js signing with BigInt values
      const value = {
        clientDataSetId: BigInt(clientDataSetId),
        pieceIds: pieceIdsBigInt
      }

      // Use underlying signer for typed data signing (handles NonceManager)
      const actualSigner = this.getUnderlyingSigner()
      signature = await actualSigner.signTypedData(
        this.domain,
        { SchedulePieceRemovals: EIP712_TYPES.SchedulePieceRemovals },
        value
      )
    }

    const sig = ethers.Signature.from(signature)

    // For EIP-712, signedData contains the actual message hash that was signed
    const signedData = ethers.TypedDataEncoder.hash(
      this.domain,
      { SchedulePieceRemovals: EIP712_TYPES.SchedulePieceRemovals },
      {
        clientDataSetId: BigInt(clientDataSetId),
        pieceIds: pieceIdsBigInt
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
   * Create signature for data set deletion
   *
   * This signature authorizes complete deletion of a data set and all
   * its associated data. This action is irreversible and will terminate
   * the storage service for this dataset.
   *
   * @param clientDataSetId - Client's dataset ID to delete
   * @returns Promise resolving to authentication signature for data set deletion
   *
   * @example
   * ```typescript
   * const auth = new PDPAuthHelper(contractAddress, signer, chainId)
   * const signature = await auth.signDeleteDataSet(
   *   0  // Dataset ID to delete
   * )
   * ```
   */
  async signDeleteDataSet (
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
        { DeleteDataSet: EIP712_TYPES.DeleteDataSet },
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
        { DeleteDataSet: EIP712_TYPES.DeleteDataSet },
        value
      )
    }

    const sig = ethers.Signature.from(signature)

    // For EIP-712, signedData contains the actual message hash that was signed
    const signedData = ethers.TypedDataEncoder.hash(
      this.domain,
      { DeleteDataSet: EIP712_TYPES.DeleteDataSet },
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
