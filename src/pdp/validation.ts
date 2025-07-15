/**
 * Type guards and validation utilities for PDP server responses
 *
 * These validators ensure that responses from untrusted PDP servers
 * match the expected format before using them in the SDK.
 */

import type {
  DataSetCreationStatusResponse,
  PieceAdditionStatusResponse,
  FindPieceResponse
} from './server.js'
import type { DataSetData, DataSetPieceData } from '../types.js'
import { asCommP } from '../commp/commp.js'

/**
 * Type guard for DataSetCreationStatusResponse
 * Validates the response from checking data set creation status
 *
 * @param value - The value to validate
 * @returns True if the value matches DataSetCreationStatusResponse interface
 */
export function isDataSetCreationStatusResponse (value: unknown): value is DataSetCreationStatusResponse {
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
export function isPieceAdditionStatusResponse (value: unknown): value is PieceAdditionStatusResponse {
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
export function isFindPieceResponse (value: unknown): value is FindPieceResponse {
  if (typeof value !== 'object' || value == null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Accept either pieceCid (new) or piece_cid (legacy)
  const hasPieceCid = typeof obj.pieceCid === 'string'
  const hasPieceCidLegacy = typeof obj.piece_cid === 'string'

  if (!hasPieceCid && !hasPieceCidLegacy) {
    return false
  }

  // Validate that the piece CID is a valid CommP
  const cidToValidate = (obj.pieceCid ?? obj.piece_cid) as string
  if (asCommP(cidToValidate) == null) {
    return false
  }

  return true
}

/**
 * Validates and returns a DataSetCreationStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validateDataSetCreationStatusResponse (value: unknown): DataSetCreationStatusResponse {
  if (!isDataSetCreationStatusResponse(value)) {
    throw new Error('Invalid data set creation status response format')
  }
  return value
}

/**
 * Validates and returns a PieceAdditionStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validatePieceAdditionStatusResponse (value: unknown): PieceAdditionStatusResponse {
  if (!isPieceAdditionStatusResponse(value)) {
    throw new Error('Invalid piece addition status response format')
  }
  return value
}

/**
 * Validates and returns a FindPieceResponse
 * Normalizes the response to always have pieceCid field as a CommP object
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validateFindPieceResponse (value: unknown): FindPieceResponse {
  if (!isFindPieceResponse(value)) {
    // Check if it failed specifically due to invalid CommP
    if (typeof value === 'object' && value != null) {
      const obj = value as Record<string, unknown>
      const cidStr = (obj.pieceCid ?? obj.piece_cid) as string | undefined
      if (cidStr != null && asCommP(cidStr) == null) {
        throw new Error('Invalid find piece response: pieceCid is not a valid CommP')
      }
    }
    throw new Error('Invalid find piece response format')
  }

  const obj = value as any

  // Get the CID string from either field
  const cidStr = (obj.pieceCid ?? obj.piece_cid) as string

  // Convert to CommP object (we know it's valid because isFindPieceResponse already checked)
  const commP = asCommP(cidStr)
  if (commP == null) {
    // This should never happen since we validated above, but just in case
    throw new Error('Invalid find piece response: pieceCid is not a valid CommP')
  }

  // Return normalized response with CommP object
  return {
    pieceCid: commP,
    piece_cid: obj.piece_cid // Keep legacy field if it exists
  }
}

/**
 * Converts and validates individual data set piece data
 * Returns null if validation fails
 *
 * @param value - The value to validate and convert
 * @returns Converted DataSetPieceData or null if invalid
 */
export function asDataSetPieceData (value: unknown): DataSetPieceData | null {
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

  // Convert CIDs to CommP objects
  const pieceCid = asCommP(obj.pieceCid)
  const subPieceCid = asCommP(obj.subPieceCid)
  if (pieceCid == null || subPieceCid == null) {
    return null
  }

  return {
    pieceId: obj.pieceId,
    pieceCid,
    subPieceCid,
    subPieceOffset: obj.subPieceOffset
  }
}

/**
 * Converts and validates data set data
 * Returns null if validation fails
 *
 * @param value - The value to validate and convert
 * @returns Converted DataSetData or null if invalid
 */
export function asDataSetData (value: unknown): DataSetData | null {
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
    nextChallengeEpoch: obj.nextChallengeEpoch
  }
}
