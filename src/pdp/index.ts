/**
 * Exports the PDP components
 *
 * @packageDocumentation
 * @module PDP
 * @example
 * ```ts
 * import { PDPAuthHelper, PDPServer, PDPVerifier } from '@filoz/synapse-sdk/pdp'
 * ```
 */

export { PDPAuthHelper } from './auth.js'
export type {
  AddPiecesResponse,
  CreateDataSetResponse,
  DataSetCreationStatusResponse,
  FindPieceResponse,
  PieceAdditionStatusResponse,
  UploadResponse,
} from './server.js'
export { PDPServer } from './server.js'
// Export validation utilities for advanced use
export {
  asDataSetData,
  asDataSetPieceData,
  isDataSetCreationStatusResponse,
  isFindPieceResponse,
  isPieceAdditionStatusResponse,
  validateDataSetCreationStatusResponse,
  validateFindPieceResponse,
  validatePieceAdditionStatusResponse,
} from './validation.js'
export { PDPVerifier } from './verifier.js'
