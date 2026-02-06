import { isSynapseError, SynapseError } from '@filoz/synapse-core/errors'

/**
 * Primary store failed - no data stored anywhere.
 * Thrown when the initial upload to the primary provider fails.
 */
export class StoreError extends SynapseError {
  override name: 'StoreError' = 'StoreError'

  static override is(value: unknown): value is StoreError {
    return isSynapseError(value) && value.name === 'StoreError'
  }
}

/**
 * Primary commit failed - data stored but not on-chain.
 * Thrown when the on-chain commit to the primary provider fails after successful store.
 */
export class CommitError extends SynapseError {
  override name: 'CommitError' = 'CommitError'

  static override is(value: unknown): value is CommitError {
    return isSynapseError(value) && value.name === 'CommitError'
  }
}
