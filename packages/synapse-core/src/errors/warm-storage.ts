import { isSynapseError, SynapseError, type SynapseErrorOptions } from './base.ts'

export class DataSetNotFoundError extends SynapseError {
  override name: 'DataSetNotFoundError' = 'DataSetNotFoundError'
  constructor(dataSetId: bigint) {
    super(`Data set ${dataSetId} not found.`)
  }

  static override is(value: unknown): value is DataSetNotFoundError {
    return isSynapseError(value) && value.name === 'DataSetNotFoundError'
  }
}

export class AtLeastOnePieceRequiredError extends SynapseError {
  override name: 'AtLeastOnePieceRequiredError' = 'AtLeastOnePieceRequiredError'
  constructor() {
    super('At least one piece must be provided')
  }

  static override is(value: unknown): value is AtLeastOnePieceRequiredError {
    return isSynapseError(value) && value.name === 'AtLeastOnePieceRequiredError'
  }
}

export class TooManyPiecesError extends SynapseError {
  override name: 'TooManyPiecesError' = 'TooManyPiecesError'
  constructor(count: number, max: number) {
    super(`Too many pieces: ${count}, max ${max} per batch. Split into smaller batches.`)
  }

  static override is(value: unknown): value is TooManyPiecesError {
    return isSynapseError(value) && value.name === 'TooManyPiecesError'
  }
}

/** A required PDP provider has no usable offering or could not be resolved. */
export class PDPProviderUnavailableError extends SynapseError {
  override name: 'PDPProviderUnavailableError' = 'PDPProviderUnavailableError'
  readonly providerId: bigint

  constructor(providerId: bigint, options?: SynapseErrorOptions) {
    super(`PDP provider ${providerId} is unavailable`, options)
    this.providerId = providerId
  }

  static override is(value: unknown): value is PDPProviderUnavailableError {
    return isSynapseError(value) && value.name === 'PDPProviderUnavailableError'
  }
}
