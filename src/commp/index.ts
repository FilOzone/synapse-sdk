// Export CommP types and utility functions
export {
  FIL_COMMITMENT_UNSEALED,
  SHA2_256_TRUNC254_PADDED,
  CommP,
  asCommP,
  calculate,
  createCommPStream,
  toZeroPaddedSize,
  toPieceSize
} from './commp.js'

export {
  downloadAndValidateCommP,
  downloadAndValidateCommPFromUrl
} from './download.js'
