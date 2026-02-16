import { isSynapseError, SynapseError, type SynapseErrorOptions } from '@filoz/synapse-core/errors'

interface StorageErrorOptions extends SynapseErrorOptions {
  providerId?: bigint
  endpoint?: string
}

/**
 * Primary store failed - no data stored anywhere.
 * Thrown when the initial upload to the primary provider fails.
 */
export class StoreError extends SynapseError {
  override name: 'StoreError' = 'StoreError'
  providerId?: string
  endpoint?: string

  constructor(message: string, options?: StorageErrorOptions) {
    super(message, options)
    this.providerId = options?.providerId?.toString()
    this.endpoint = options?.endpoint
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      providerId: this.providerId,
      endpoint: this.endpoint,
    }
  }

  static override is(value: unknown): value is StoreError {
    return isSynapseError(value) && value.name === 'StoreError'
  }
}

/**
 * All commits failed - data stored but not on-chain.
 * Thrown when on-chain commit fails on every provider after successful store.
 */
export class CommitError extends SynapseError {
  override name: 'CommitError' = 'CommitError'
  providerId?: string
  endpoint?: string

  constructor(message: string, options?: StorageErrorOptions) {
    super(message, options)
    this.providerId = options?.providerId?.toString()
    this.endpoint = options?.endpoint
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      providerId: this.providerId,
      endpoint: this.endpoint,
    }
  }

  static override is(value: unknown): value is CommitError {
    return isSynapseError(value) && value.name === 'CommitError'
  }
}
