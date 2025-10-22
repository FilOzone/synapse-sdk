import { calibration, mainnet } from '../chains.ts'
import { isSynapseError, SynapseError } from './base.ts'

export class UnsupportedChainError extends SynapseError {
  override name: 'UnsupportedChainError' = 'UnsupportedChainError'

  constructor(chainId: number) {
    super(
      `Unsupported chain: ${chainId} (only Filecoin mainnet (${mainnet.id}) and calibration (${calibration.id}) are supported)`
    )
  }

  static override is(value: unknown): value is UnsupportedChainError {
    return isSynapseError(value) && value.name === 'UnsupportedChainError'
  }
}
