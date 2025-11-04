import { isSynapseError, SynapseError } from './base.ts'

export class DataSetNotFoundError extends SynapseError {
  override name: 'DataSetNotFoundError' = 'DataSetNotFoundError'
  constructor(dataSetId: bigint) {
    super(`Data set ${dataSetId} not found.`)
  }

  static override is(value: unknown): value is DataSetNotFoundError {
    return isSynapseError(value) && value.name === 'DataSetNotFoundError'
  }
}
