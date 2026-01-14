import { isSynapseError, SynapseError } from './base.ts'

export class GetDataSetStatsError extends SynapseError {
  override name: 'GetDataSetStatsError' = 'GetDataSetStatsError'

  constructor(message: string, details?: string) {
    super(message, { details })
  }

  static override is(value: unknown): value is GetDataSetStatsError {
    return isSynapseError(value) && value.name === 'GetDataSetStatsError'
  }
}
