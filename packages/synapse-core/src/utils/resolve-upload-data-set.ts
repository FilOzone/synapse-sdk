import { ValidationError } from '../errors/base.ts'
import { ServiceAlreadyTerminatedError } from '../errors/pdp.ts'

/** Resolved on-chain state required to calculate an upload to an existing data set. */
export type UploadDataSetState = {
  /** Aggregate leaf count reported by PDP Verifier. */
  leafCount: bigint
  /** Current fixed lifecycle reserve balance mirrored from the PDP payment rail. */
  lifecycleReserveBalance: bigint
  /** One-time operation fees waiting to be flushed from the lifecycle reserve. */
  pendingOneTimePayments: bigint
  /** Epoch at which the PDP payment rail ends. 0n while the service is active. */
  pdpEndEpoch: bigint
}

export type ResolveUploadDataSetOptions = {
  isNewDataSet: boolean
  dataSetLeafCount?: bigint
  currentLifecycleReserveBalance?: bigint
  pendingOneTimePayments?: bigint
  pdpEndEpoch?: bigint
}

/** Throw when an existing data set can no longer accept uploads. */
export function assertUploadDataSetIsActive(dataSet: UploadDataSetState): void {
  if (dataSet.pdpEndEpoch !== 0n) {
    throw new ServiceAlreadyTerminatedError(dataSet.pdpEndEpoch)
  }
}

/** Resolve and validate the data-set state used by single-context upload cost calculations. */
export function resolveUploadDataSet(options: ResolveUploadDataSetOptions): UploadDataSetState | null {
  if (options.isNewDataSet) return null

  if (options.dataSetLeafCount == null) {
    throw new ValidationError('dataSetLeafCount is required for an existing data set')
  }
  if (options.currentLifecycleReserveBalance == null) {
    throw new ValidationError('currentLifecycleReserveBalance is required for an existing data set')
  }
  if (options.pdpEndEpoch == null) {
    throw new ValidationError('pdpEndEpoch is required for an existing data set')
  }

  const dataSet = {
    leafCount: options.dataSetLeafCount,
    lifecycleReserveBalance: options.currentLifecycleReserveBalance,
    pendingOneTimePayments: options.pendingOneTimePayments ?? 0n,
    pdpEndEpoch: options.pdpEndEpoch,
  }
  assertUploadDataSetIsActive(dataSet)
  return dataSet
}
