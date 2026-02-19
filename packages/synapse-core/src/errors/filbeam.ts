import { isSynapseError, SynapseError } from './base.ts'

export class GetDataSetStatsError extends SynapseError {
  override name: 'GetDataSetStatsError' = 'GetDataSetStatsError'

  static override is(value: unknown): value is GetDataSetStatsError {
    return isSynapseError(value) && value.name === 'GetDataSetStatsError'
  }
}
