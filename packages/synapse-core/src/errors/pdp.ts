import { decodePDPError } from '../utils/decode-pdp-errors.ts'
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
