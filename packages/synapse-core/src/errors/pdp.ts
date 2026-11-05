import type { Hash, ReplacementReason } from 'viem'
import type { PieceCID } from '../piece/piece-cid.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { decodePDPError } from '../utils/decode-pdp-errors.ts'
import type { MetadataObject } from '../utils/metadata.ts'
import { isSynapseError, SynapseError } from './base.ts'

export class LocationHeaderError extends SynapseError {
  override name: 'LocationHeaderError' = 'LocationHeaderError'

  constructor(location?: string | null) {
    super(`Location header format is invalid: ${location ?? '<none>'}`)
  }

  static override is(value: unknown): value is LocationHeaderError {
    return isSynapseError(value) && value.name === 'LocationHeaderError'
  }
}

export class CreateDataSetError extends SynapseError {
  override name: 'CreateDataSetError' = 'CreateDataSetError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to create data set.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is CreateDataSetError {
    return isSynapseError(value) && value.name === 'CreateDataSetError'
  }
}

export class GetDataSetError extends SynapseError {
  override name: 'GetDataSetError' = 'GetDataSetError'

  constructor(error: string) {
    super(error ? 'Failed to get data set.' : 'Data set not found.', {
      details: error ? decodePDPError(error) : undefined,
    })
  }

  static override is(value: unknown): value is GetDataSetError {
    return isSynapseError(value) && value.name === 'GetDataSetError'
  }
}

export class PostPieceError extends SynapseError {
  override name: 'PostPieceError' = 'PostPieceError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to create upload session.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is PostPieceError {
    return isSynapseError(value) && value.name === 'PostPieceError'
  }
}

export class UploadPieceError extends SynapseError {
  override name: 'UploadPieceError' = 'UploadPieceError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to upload piece.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is UploadPieceError {
    return isSynapseError(value) && value.name === 'UploadPieceError'
  }
}

export class FindPieceError extends SynapseError {
  override name: 'FindPieceError' = 'FindPieceError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to find piece.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is FindPieceError {
    return isSynapseError(value) && value.name === 'FindPieceError'
  }
}

export class AddPiecesError extends SynapseError {
  override name: 'AddPiecesError' = 'AddPiecesError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to add pieces.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is AddPiecesError {
    return isSynapseError(value) && value.name === 'AddPiecesError'
  }
}

export class AddPiecesBatchTooLargeError extends SynapseError {
  override name: 'AddPiecesBatchTooLargeError' = 'AddPiecesBatchTooLargeError'
  readonly pieceCount: number

  constructor(pieceCount: number) {
    super(`Piece batch of ${pieceCount} does not fit in a single Filecoin message. Split into smaller batches.`)
    this.pieceCount = pieceCount
  }

  static override is(value: unknown): value is AddPiecesBatchTooLargeError {
    return isSynapseError(value) && value.name === 'AddPiecesBatchTooLargeError'
  }
}

export class AddPiecesFlushError extends SynapseError {
  override name: 'AddPiecesFlushError' = 'AddPiecesFlushError'
  readonly pieceCid: PieceCID
  readonly metadata?: MetadataObject
  /** The window that failed. Same extraData / same tx attempt. */
  readonly pieces: Array<{ pieceCid: PieceCID; metadata?: MetadataObject }>

  constructor(options: {
    pieceCid: PieceCID
    metadata?: MetadataObject
    pieces: Array<{ pieceCid: PieceCID; metadata?: MetadataObject }>
    cause: Error
  }) {
    super('Failed to add pieces.', { cause: options.cause })
    this.pieceCid = options.pieceCid
    this.metadata = options.metadata
    this.pieces = options.pieces
  }

  static override is(value: unknown): value is AddPiecesFlushError {
    return isSynapseError(value) && value.name === 'AddPiecesFlushError'
  }
}

export class TransactionNotAppliedError extends SynapseError {
  override name: 'TransactionNotAppliedError' = 'TransactionNotAppliedError'
  /** Original transaction hash from the SP. */
  txHash: Hash
  /** Hash of the transaction that landed in its place. */
  confirmedTxHash: Hash
  /** Whether the landed transaction reverted. */
  reverted: boolean
  /** How the original was replaced, when it was. */
  replacement?: ReplacementReason

  constructor(options: { txHash: Hash; confirmedTxHash: Hash; reverted: boolean; replacement?: ReplacementReason }) {
    super(`Transaction landed without applying the call.`, {
      details: `Tx hash: ${options.txHash}, confirmed tx hash: ${options.confirmedTxHash}, reverted: ${options.reverted}, replacement: ${options.replacement ?? 'none'}`,
    })
    this.txHash = options.txHash
    this.confirmedTxHash = options.confirmedTxHash
    this.reverted = options.reverted
    this.replacement = options.replacement
  }

  static override is(value: unknown): value is TransactionNotAppliedError {
    return isSynapseError(value) && value.name === 'TransactionNotAppliedError'
  }
}

export class DeletePieceError extends SynapseError {
  override name: 'DeletePieceError' = 'DeletePieceError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to delete piece.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is DeletePieceError {
    return isSynapseError(value) && value.name === 'DeletePieceError'
  }
}

export class TerminateServiceError extends SynapseError {
  override name: 'TerminateServiceError' = 'TerminateServiceError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to request data set termination.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is TerminateServiceError {
    return isSynapseError(value) && value.name === 'TerminateServiceError'
  }
}

export class ServiceAlreadyTerminatedError extends SynapseError {
  override name: 'ServiceAlreadyTerminatedError' = 'ServiceAlreadyTerminatedError'
  /** The epoch at which the PDP payment rail ends. */
  endEpoch: bigint

  constructor(endEpoch: bigint) {
    super(`Data set service is already terminated.`, {
      details: `Service termination epoch: ${endEpoch}`,
    })
    this.endEpoch = endEpoch
  }

  static override is(value: unknown): value is ServiceAlreadyTerminatedError {
    return isSynapseError(value) && value.name === 'ServiceAlreadyTerminatedError'
  }
}

export class TerminateServicePendingError extends SynapseError {
  override name: 'TerminateServicePendingError' = 'TerminateServicePendingError'

  constructor() {
    super(`Data set termination is already pending.`, {
      details:
        'A termination request is already queued with the service provider. If it was initiated by the provider it cannot be tracked via the termination status endpoint.',
    })
  }

  static override is(value: unknown): value is TerminateServicePendingError {
    return isSynapseError(value) && value.name === 'TerminateServicePendingError'
  }
}

export class TerminateServiceNotSupportedError extends SynapseError {
  override name: 'TerminateServiceNotSupportedError' = 'TerminateServiceNotSupportedError'

  constructor(error: string) {
    super(`Service provider does not support relayed termination.`, {
      details: decodePDPError(error),
    })
  }

  static override is(value: unknown): value is TerminateServiceNotSupportedError {
    return isSynapseError(value) && value.name === 'TerminateServiceNotSupportedError'
  }
}

export class WaitForTerminateServiceError extends SynapseError {
  override name: 'WaitForTerminateServiceError' = 'WaitForTerminateServiceError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to wait for data set termination.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is WaitForTerminateServiceError {
    return isSynapseError(value) && value.name === 'WaitForTerminateServiceError'
  }
}

export class WaitForTerminateServiceNotFoundError extends SynapseError {
  override name: 'WaitForTerminateServiceNotFoundError' = 'WaitForTerminateServiceNotFoundError'

  constructor() {
    super(`No client-requested termination found for this data set service.`, {
      details:
        "The service provider's termination transaction may have failed, discarding the request. Retry, or terminate on-chain.",
    })
  }

  static override is(value: unknown): value is WaitForTerminateServiceNotFoundError {
    return isSynapseError(value) && value.name === 'WaitForTerminateServiceNotFoundError'
  }
}

export class WaitForTerminateServiceRejectedError extends SynapseError {
  override name: 'WaitForTerminateServiceRejectedError' = 'WaitForTerminateServiceRejectedError'
  hash: Hash

  constructor(hash: Hash) {
    super(`Data set termination transaction failed.`, {
      details: `Tx hash: ${hash}`,
    })
    this.hash = hash
  }

  static override is(value: unknown): value is WaitForTerminateServiceRejectedError {
    return isSynapseError(value) && value.name === 'WaitForTerminateServiceRejectedError'
  }
}

export class InvalidUploadSizeError extends SynapseError {
  override name: 'InvalidUploadSizeError' = 'InvalidUploadSizeError'

  constructor(size: number) {
    super(`Invalid upload size.`, {
      details: `Size ${size} bytes is below minimum allowed size of ${SIZE_CONSTANTS.MIN_UPLOAD_SIZE} bytes or exceeds maximum allowed size of ${SIZE_CONSTANTS.MAX_UPLOAD_SIZE} bytes (64 GiB padded)`,
    })
  }

  static override is(value: unknown): value is InvalidUploadSizeError {
    return isSynapseError(value) && value.name === 'InvalidUploadSizeError'
  }
}

export class DownloadPieceError extends SynapseError {
  override name: 'DownloadPieceError' = 'DownloadPieceError'

  constructor(error: string) {
    super(`Failed to download piece.`, {
      details: error,
    })
  }

  static override is(value: unknown): value is DownloadPieceError {
    return isSynapseError(value) && value.name === 'DownloadPieceError'
  }
}
