import { decodePDPError } from '../utils/decode-pdp-errors.ts'
import { isSynapseError, SynapseError } from './base.ts'

export class InvalidPDPLocationHeaderError extends SynapseError {
  override name: 'InvalidPDPLocationHeaderError' = 'InvalidPDPLocationHeaderError'

  constructor(location: string) {
    super(`Invalid PDP location header format: ${location}`)
  }

  static override is(value: unknown): value is InvalidPDPLocationHeaderError {
    return isSynapseError(value) && value.name === 'InvalidPDPLocationHeaderError'
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

export class PollDataSetCreationStatusError extends SynapseError {
  override name: 'PollDataSetCreationStatusError' = 'PollDataSetCreationStatusError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to check data set creation status.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is PollDataSetCreationStatusError {
    return isSynapseError(value) && value.name === 'PollDataSetCreationStatusError'
  }
}

export class GetDataSetError extends SynapseError {
  override name: 'GetDataSetError' = 'GetDataSetError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to get data set.`, {
      details: decodedError,
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
    super(`Failed to post piece.`, {
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

export class PollForAddPiecesStatusError extends SynapseError {
  override name: 'PollForAddPiecesStatusError' = 'PollForAddPiecesStatusError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to poll for add pieces status.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is PollForAddPiecesStatusError {
    return isSynapseError(value) && value.name === 'PollForAddPiecesStatusError'
  }
}
