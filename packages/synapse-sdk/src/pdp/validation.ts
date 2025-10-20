/**
 * Type guards and validation utilities for PDP server responses
 *
 * These validators ensure that responses from untrusted PDP servers
 * match the expected format before using them in the SDK.
 */

import { asPieceCID } from '../piece/index.ts'
import type { DataSetData, DataSetPieceData } from '../types.ts'
import type {
  DataSetCreationStatusResponse,
  FindPieceResponse,
  PieceAdditionStatusResponse,
  PieceStatusResponse,
} from './server.ts'

/**
 * Type guard for DataSetCreationStatusResponse
 * Validates the response from checking data set creation status
 *
 * @param value - The value to validate
 * @returns True if the value matches DataSetCreationStatusResponse interface
 */
export function isDataSetCreationStatusResponse(value: unknown): value is DataSetCreationStatusResponse {
  if (typeof value !== 'object' || value == null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Required fields
  if (typeof obj.createMessageHash !== 'string') {
    return false
  }
  if (typeof obj.dataSetCreated !== 'boolean') {
    return false
  }
  if (typeof obj.service !== 'string') {
    return false
  }
  if (typeof obj.txStatus !== 'string') {
    return false
  }
  if (obj.ok !== null && typeof obj.ok !== 'boolean') {
    return false
  }

  // Optional field
  if (obj.dataSetId !== undefined && typeof obj.dataSetId !== 'number') {
    return false
  }

  return true
}

/**
 * Type guard for PieceAdditionStatusResponse
 * Validates the response from checking piece addition status
 *
 * @param value - The value to validate
 * @returns True if the value matches PieceAdditionStatusResponse interface
 */
export function isPieceAdditionStatusResponse(value: unknown): value is PieceAdditionStatusResponse {
  if (typeof value !== 'object' || value == null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Required fields
  if (typeof obj.txHash !== 'string') {
    return false
  }
  if (typeof obj.txStatus !== 'string') {
    return false
  }
  if (typeof obj.dataSetId !== 'number') {
    return false
  }
  if (typeof obj.pieceCount !== 'number') {
    return false
  }
  if (obj.addMessageOk !== null && typeof obj.addMessageOk !== 'boolean') {
    return false
  }

  // Optional field - confirmedPieceIds
  if (obj.confirmedPieceIds !== undefined) {
    if (!Array.isArray(obj.confirmedPieceIds)) {
      return false
    }
    // Check all elements are numbers
    for (const id of obj.confirmedPieceIds) {
      if (typeof id !== 'number') {
        return false
      }
    }
  }

  return true
}

/**
 * Type guard for FindPieceResponse
 * Validates the response from finding a piece
 * Supports both pieceCid (new) and piece_cid (legacy) field names for backward compatibility
 *
 * @param value - The value to validate
 * @returns True if the value matches FindPieceResponse interface
 */
export function isFindPieceResponse(value: unknown): value is FindPieceResponse {
  if (typeof value !== 'object' || value == null) {
    return false
  }

  const obj = value as Record<string, unknown>

  if (typeof obj.pieceCid !== 'string') {
    return false
  }

  // Validate that the piece CID is a valid PieceCID
  if (asPieceCID(obj.pieceCid) == null) {
    return false
  }

  return true
}

/**
 * Validates and returns a DataSetCreationStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validateDataSetCreationStatusResponse(value: unknown): DataSetCreationStatusResponse {
  if (!isDataSetCreationStatusResponse(value)) {
    throw new Error('Invalid data set creation status response format')
  }
  return value
}

export function validatePieceDeleteResponse(value: unknown): { txHash: string } {
  if (typeof value !== 'object' || value == null) {
    throw new Error('Invalid piece delete response format')
  }

  const obj = value as Record<string, unknown>

  if (typeof obj.txHash !== 'string') {
    throw new Error('Invalid piece delete response format')
  }

  return {
    txHash: obj.txHash,
  }
}

/**
 * Validates and returns a PieceAdditionStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validatePieceAdditionStatusResponse(value: unknown): PieceAdditionStatusResponse {
  if (!isPieceAdditionStatusResponse(value)) {
    throw new Error('Invalid piece addition status response format')
  }
  return value
}

/**
 * Validates and returns a FindPieceResponse
 * Normalizes the response to always have pieceCid field as a PieceCID object
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validateFindPieceResponse(value: unknown): FindPieceResponse {
  if (!isFindPieceResponse(value)) {
    // Check if it failed specifically due to invalid PieceCID
    if (typeof value === 'object' && value != null) {
      const obj = value as Record<string, unknown>
      const cidStr = (obj.pieceCid ?? obj.piece_cid) as string | undefined
      if (cidStr != null && asPieceCID(cidStr) == null) {
        throw new Error('Invalid find piece response: pieceCid is not a valid PieceCID')
      }
    }
    throw new Error('Invalid find piece response format')
  }

  const obj = value as any

  // Get the CID string from either field
  const cidStr = (obj.pieceCid ?? obj.piece_cid) as string

  // Convert to PieceCID object (we know it's valid because isFindPieceResponse already checked)
  const pieceCid = asPieceCID(cidStr)
  if (pieceCid == null) {
    // This should never happen since we validated above, but just in case
    throw new Error('Invalid find piece response: pieceCid is not a valid PieceCID')
  }

  // Return normalized response with PieceCID object
  return {
    pieceCid,
    piece_cid: obj.piece_cid, // Keep legacy field if it exists
  }
}

/**
 * Type guard for PieceStatusResponse
 * Validates the response from checking piece indexing and IPNI status
 *
 * @param value - The value to validate
 * @returns True if the value matches PieceStatusResponse interface
 */
export function isPieceStatusResponse(value: unknown): value is PieceStatusResponse {
  if (typeof value !== 'object' || value == null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Required fields
  if (typeof obj.pieceCid !== 'string') {
    return false
  }
  if (typeof obj.status !== 'string') {
    return false
  }
  if (typeof obj.indexed !== 'boolean') {
    return false
  }
  if (typeof obj.advertised !== 'boolean') {
    return false
  }
  if (typeof obj.retrieved !== 'boolean') {
    return false
  }

  // Optional field
  if (obj.retrievedAt !== undefined && typeof obj.retrievedAt !== 'string') {
    return false
  }

  return true
}

/**
 * Validates and returns a PieceStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validatePieceStatusResponse(value: unknown): PieceStatusResponse {
  if (!isPieceStatusResponse(value)) {
    throw new Error('Invalid piece status response format')
  }
  return value
}

/**
 * Converts and validates individual data set piece data
 * Returns null if validation fails
 *
 * @param value - The value to validate and convert
 * @returns Converted DataSetPieceData or null if invalid
 */
export function asDataSetPieceData(value: unknown): DataSetPieceData | null {
  if (typeof value !== 'object' || value == null) {
    return null
  }

  const obj = value as Record<string, unknown>

  // Required fields
  if (typeof obj.pieceId !== 'number') {
    return null
  }
  if (typeof obj.pieceCid !== 'string') {
    return null
  }
  if (typeof obj.subPieceCid !== 'string') {
    return null
  }
  if (typeof obj.subPieceOffset !== 'number') {
    return null
  }

  // Convert CIDs to PieceCID objects
  const pieceCid = asPieceCID(obj.pieceCid)
  const subPieceCid = asPieceCID(obj.subPieceCid)
  if (pieceCid == null || subPieceCid == null) {
    return null
  }

  return {
    pieceId: obj.pieceId,
    pieceCid,
    subPieceCid,
    subPieceOffset: obj.subPieceOffset,
  }
}

/**
 * Converts and validates data set data
 * Returns null if validation fails
 *
 * @param value - The value to validate and convert
 * @returns Converted DataSetData or null if invalid
 */
export function asDataSetData(value: unknown): DataSetData | null {
  if (typeof value !== 'object' || value == null) {
    return null
  }

  const obj = value as Record<string, unknown>

  // Required field - id
  if (typeof obj.id !== 'number') {
    return null
  }

  // Required field - pieces (array of DataSetPieceData)
  if (!Array.isArray(obj.pieces)) {
    return null
  }

  const convertedPieces: DataSetPieceData[] = []
  for (const piece of obj.pieces) {
    const convertedPiece = asDataSetPieceData(piece)
    if (convertedPiece == null) {
      return null
    }
    convertedPieces.push(convertedPiece)
  }

  // Required field - nextChallengeEpoch
  if (typeof obj.nextChallengeEpoch !== 'number') {
    return null
  }

  return {
    id: obj.id,
    pieces: convertedPieces,
    nextChallengeEpoch: obj.nextChallengeEpoch,
  }
}
