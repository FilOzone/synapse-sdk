/**
 * Common signer utilities for handling various ethers.js signer types
 */

import { ethers } from 'ethers'

/**
 * Get the underlying signer, unwrapping NonceManager if present
 *
 * NonceManager wraps the actual signer to manage nonces automatically.
 * For operations like signTypedData, we need the underlying signer.
 *
 * @param signer - The signer that may be wrapped
 * @returns The underlying signer
 */
export function getUnderlyingSigner (signer: ethers.Signer): ethers.Signer {
  // Check if this is a NonceManager wrapping another signer
  if ('signer' in signer && signer.constructor.name === 'NonceManager') {
    return (signer as any).signer
  }
  return signer
}

/**
 * Check if the signer is a browser-based signer (MetaMask, WalletConnect, etc)
 * that requires special handling for EIP-712 signatures
 *
 * @param signer - The signer to check
 * @returns Promise resolving to true if browser-based signer
 */
export async function isBrowserSigner (signer: ethers.Signer): Promise<boolean> {
  try {
    // Get the actual signer (unwrap NonceManager if needed)
    const actualSigner = getUnderlyingSigner(signer)

    // If it's a Wallet, it can sign locally, so not a browser signer
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

    // Check for provider with send method (indicates external provider)
    if ('send' in provider || 'request' in provider) {
      return true
    }
  } catch {
    // Silently fail and return false
  }
  return false
}

/**
 * Get EIP-1193 provider from various provider types
 * Used for direct communication with browser wallets
 *
 * @param provider - The provider to extract EIP-1193 provider from
 * @returns The EIP-1193 provider or the original provider
 */
export function getEIP1193Provider (provider: any): any {
  if ('_eip1193Provider' in provider) {
    // BrowserProvider in ethers v6
    return provider._eip1193Provider
  } else if ('request' in provider) {
    // Already an EIP-1193 provider
    return provider
  }
  // Fallback to original provider
  return provider
}
