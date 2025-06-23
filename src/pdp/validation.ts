/**
 * Type guards and validation utilities for PDP server responses
 *
 * These validators ensure that responses from untrusted PDP servers
 * match the expected format before using them in the SDK.
 */

import type {
  ProofSetCreationStatusResponse,
  RootAdditionStatusResponse,
  FindPieceResponse
} from './server.js'
import { asCommP } from '../commp/commp.js'

/**
 * Type guard for ProofSetCreationStatusResponse
 * Validates the response from checking proof set creation status
 *
 * @param value - The value to validate
 * @returns True if the value matches ProofSetCreationStatusResponse interface
 */
export function isProofSetCreationStatusResponse (value: unknown): value is ProofSetCreationStatusResponse {
  if (typeof value !== 'object' || value == null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Required fields
  if (typeof obj.createMessageHash !== 'string') {
    return false
  }
  if (typeof obj.proofsetCreated !== 'boolean') {
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
  if (obj.proofSetId !== undefined && typeof obj.proofSetId !== 'number') {
    return false
  }

  return true
}

/**
 * Type guard for RootAdditionStatusResponse
 * Validates the response from checking root addition status
 *
 * @param value - The value to validate
 * @returns True if the value matches RootAdditionStatusResponse interface
 */
export function isRootAdditionStatusResponse (value: unknown): value is RootAdditionStatusResponse {
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
  if (typeof obj.proofSetId !== 'number') {
    return false
  }
  if (typeof obj.rootCount !== 'number') {
    return false
  }
  if (obj.addMessageOk !== null && typeof obj.addMessageOk !== 'boolean') {
    return false
  }

  // Optional field - confirmedRootIds
  if (obj.confirmedRootIds !== undefined) {
    if (!Array.isArray(obj.confirmedRootIds)) {
      return false
    }
    // Check all elements are numbers
    for (const id of obj.confirmedRootIds) {
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
 * Validates and returns a ProofSetCreationStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validateProofSetCreationStatusResponse (value: unknown): ProofSetCreationStatusResponse {
  if (!isProofSetCreationStatusResponse(value)) {
    throw new Error('Invalid proof set creation status response format')
  }
  return value
}

/**
 * Validates and returns a RootAdditionStatusResponse
 * @param value - The value to validate
 * @throws Error if validation fails
 */
export function validateRootAdditionStatusResponse (value: unknown): RootAdditionStatusResponse {
  if (!isRootAdditionStatusResponse(value)) {
    throw new Error('Invalid root addition status response format')
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
