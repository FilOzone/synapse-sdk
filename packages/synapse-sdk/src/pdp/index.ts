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

export { PDPAuthHelper } from './auth.ts'
export type {
  AddPiecesResponse,
  CreateDataSetResponse,
  CreateDataSetWithPiecesResponse,
  DataSetCreationStatusResponse,
  FindPieceResponse,
  PieceAdditionStatusResponse,
  UploadResponse,
} from './server.ts'
export { PDPServer } from './server.ts'
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
} from './validation.ts'
export { PDPVerifier } from './verifier.ts'
