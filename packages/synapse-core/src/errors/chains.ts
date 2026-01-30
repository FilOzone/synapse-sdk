import { calibration, devnet, mainnet } from '../chains.ts'
import { isSynapseError, SynapseError } from './base.ts'

export class UnsupportedChainError extends SynapseError {
  override name: 'UnsupportedChainError' = 'UnsupportedChainError'

  constructor(chainId: number) {
    super(
      `Unsupported chain: ${chainId} (only Filecoin mainnet (${mainnet.id}), calibration (${calibration.id}), and devnet (${devnet.id}) are supported). Import chains from @filoz/synapse-core/chains to get the correct chain.`
    )
  }

  static override is(value: unknown): value is UnsupportedChainError {
    return isSynapseError(value) && value.name === 'UnsupportedChainError'
  }
}
