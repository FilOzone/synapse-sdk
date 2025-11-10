/**
 * PieceCID (Piece Commitment CID) utilities
 *
 * Helper functions for working with Filecoin Piece CIDs
 */

import type { LegacyPieceLink as LegacyPieceCIDType, PieceLink as PieceCIDType } from '@web3-storage/data-segment'
import * as Hasher from '@web3-storage/data-segment/multihash'
import { Unpadded } from '@web3-storage/data-segment/piece/size'
import { CID } from 'multiformats/cid'
import * as Raw from 'multiformats/codecs/raw'
import * as Digest from 'multiformats/hashes/digest'
import * as Link from 'multiformats/link'
import { type Hex, hexToBytes } from 'viem'

const FIL_COMMITMENT_UNSEALED = 0xf101
const SHA2_256_TRUNC254_PADDED = 0x1012

/**
 * Maximum upload size currently supported by PDP servers.
 *
 * 1 GiB adjusted for fr32 expansion: 1 GiB * (127/128) = 1,065,353,216 bytes
 *
 * Fr32 encoding adds 2 bits of padding per 254 bits of data, resulting in 128 bytes
 * of padded data for every 127 bytes of raw data.
 *
 * Note: While it's technically possible to upload pieces this large as Uint8Array,
 * streaming via AsyncIterable is strongly recommended for non-trivial sizes.
 * See SIZE_CONSTANTS.MAX_UPLOAD_SIZE in synapse-sdk for detailed guidance.
 */
export const MAX_UPLOAD_SIZE = 1_065_353_216 // 1 GiB * 127/128

/**
 * PieceCID - A constrained CID type for Piece Commitments.
 * This is implemented as a Link type which is made concrete by a CID. A
 * PieceCID uses the raw codec (0x55) and the fr32-sha256-trunc254-padbintree
 * multihash function (0x1011) which encodes the base content length (as
 * padding) of the original piece, and the height of the merkle tree used to
 * hash it.
 *
 * See https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 * for more information.
 */
export type PieceCID = PieceCIDType

/**
 * LegacyPieceCID - A constrained CID type for Legacy Piece Commitments.
 * This is implemented as a Link type which is made concrete by a CID.
 *
 * A LegacyPieceCID uses the fil-commitment-unsealed codec (0xf101) and the
 * sha2-256-trunc254-padded (0x1012) multihash function.
 *
 * This 32 bytes of the hash digest in a LegacyPieceCID is the same as the
 * equivalent PieceCID, but a LegacyPieceCID does not encode the length or
 * tree height of the original raw piece. A PieceCID can be converted to a
 * LegacyPieceCID, but not vice versa.
 *
 * LegacyPieceCID is commonly known as "CommP" or simply "Piece Commitment"
 * in Filecoin.
 */
export type LegacyPieceCID = LegacyPieceCIDType

/**
 * Parse a PieceCID string into a CID and validate it
 * @param pieceCidString - The PieceCID as a string (base32 or other multibase encoding)
 * @returns The parsed and validated PieceCID CID or null if invalid
 */
function parsePieceCID(pieceCidString: string): PieceCID | null {
  try {
    const cid = CID.parse(pieceCidString)
    if (isValidPieceCID(cid)) {
      return cid as PieceCID
    }
  } catch {
    // ignore error
  }
  return null
}

/**
 * Parse a LegacyPieceCID string into a CID and validate it
 * @param pieceCidString - The LegacyPieceCID as a string (base32 or other multibase encoding)
 * @returns The parsed and validated LegacyPieceCID CID or null if invalid
 */
function parseLegacyPieceCID(pieceCidString: string): LegacyPieceCID | null {
  try {
    const cid = CID.parse(pieceCidString)
    if (isValidLegacyPieceCID(cid)) {
      return cid as LegacyPieceCID
    }
  } catch {
    // ignore error
  }
  return null
}

/**
 * Type guard to check if a value is a CID
 * @param value - The value to check
 * @returns True if it's a CID
 */
function isCID(value: unknown): value is CID {
  return typeof value === 'object' && value !== null && CID.asCID(value as CID) !== null
}

/**
 * Check if a CID is a valid PieceCID
 * @param cid - The CID to check
 * @returns True if it's a valid PieceCID
 */
function isValidPieceCID(cid: PieceCID | CID): cid is PieceCID {
  return cid.code === Raw.code && cid.multihash.code === Hasher.code
}

/**
 * Check if a CID is a valid LegacyPieceCID
 * @param cid - The CID to check
 * @returns True if it's a valid LegacyPieceCID
 */
function isValidLegacyPieceCID(cid: LegacyPieceCID | CID): cid is LegacyPieceCID {
  return cid.code === FIL_COMMITMENT_UNSEALED && cid.multihash.code === SHA2_256_TRUNC254_PADDED
}

/**
 * Convert a PieceCID input (string or CID) to a validated CID
 * This is the main function to use when accepting PieceCID inputs
 * @param pieceCidInput - PieceCID as either a CID object or string
 * @returns The validated PieceCID CID or null if not a valid PieceCID
 */
export function asPieceCID(pieceCidInput: PieceCID | CID | string | null | undefined): PieceCID | null {
  if (pieceCidInput === null || pieceCidInput === undefined) {
    return null
  }

  if (typeof pieceCidInput === 'string') {
    return parsePieceCID(pieceCidInput)
  }

  if (isCID(pieceCidInput)) {
    if (isValidPieceCID(pieceCidInput)) {
      return pieceCidInput
    }
  }

  return null
}

/**
 * Convert a LegacyPieceCID input (string or CID) to a validated CID
 * This function can be used to parse a LegacyPieceCID (CommPv1) or to downgrade a PieceCID
 * (CommPv2) to a LegacyPieceCID.
 * @param pieceCidInput - LegacyPieceCID as either a CID object or string
 * @returns The validated LegacyPieceCID CID or null if not a valid LegacyPieceCID
 */
export function asLegacyPieceCID(
  pieceCidInput: PieceCID | LegacyPieceCID | CID | string | null | undefined
): LegacyPieceCID | null {
  if (pieceCidInput === null || pieceCidInput === undefined) {
    return null
  }

  // Try converting as PieceCID first (handles PieceCID and CID types)
  const pieceCid = asPieceCID(pieceCidInput as PieceCID | CID | string | null | undefined)
  if (pieceCid != null) {
    // Downgrade PieceCID to LegacyPieceCID
    const digest = Digest.create(SHA2_256_TRUNC254_PADDED, pieceCid.multihash.digest.subarray(-32))
    return Link.create(FIL_COMMITMENT_UNSEALED, digest) as LegacyPieceCID
  }

  if (typeof pieceCidInput === 'string') {
    return parseLegacyPieceCID(pieceCidInput)
  }

  if (isCID(pieceCidInput)) {
    if (isValidLegacyPieceCID(pieceCidInput)) {
      return pieceCidInput
    }
  }

  return null
}

/**
 * Extract the raw (unpadded) size from a PieceCIDv2
 *
 * PieceCIDv2 encodes the original data size in its multihash digest through
 * the tree height and padding values. This function decodes those values to
 * calculate the original raw data size.
 *
 * @param pieceCid - PieceCID
 * @returns The raw size in bytes
 * @throws {Error} If the input is not a valid PieceCIDv2
 */
export function getSize(pieceCid: PieceCID): number {
  // The multihash digest contains: [padding (varint)][height (1 byte)][root (32 bytes)]
  const digest = Hasher.Digest.fromBytes(pieceCid.multihash.bytes)
  const height = digest.height
  const padding = digest.padding

  // rawSize = paddedSize - padding
  // where paddedSize = 2^(height-2) * 127 (fr32 expansion)
  const rawSize = Unpadded.fromPiece({ height, padding })

  // This should be safe for all practical file sizes
  if (rawSize > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Raw size ${rawSize} exceeds maximum safe integer`)
  }

  return Number(rawSize)
}

/**
 * Extract the raw (unpadded) size from a PieceCIDv2
 *
 * Accepts PieceCID as string, CID object, or PieceCID type
 *
 * @param pieceCidInput - PieceCID as either a CID object or string
 * @returns The raw size in bytes
 * @throws {Error} If the input is not a valid PieceCIDv2
 */
export function getSizeFromPieceCID(pieceCidInput: PieceCID | CID | string): number {
  const pieceCid = asPieceCID(pieceCidInput)
  if (pieceCid == null) {
    throw new Error('Invalid PieceCID: input must be a valid PieceCIDv2')
  }
  return getSize(pieceCid)
}

export function parse(pieceCid: string): PieceCID {
  try {
    const cid = CID.parse(pieceCid).toV1()
    if (!isPieceCID(cid)) {
      throw new Error('Invalid PieceCID: input must be a valid PieceCIDv2')
    }
    return cid
  } catch {
    throw new Error(`Invalid CID string: ${pieceCid}`)
  }
}

/**
 * Check if a CID is a valid PieceCID
 * @param cid - The CID to check
 * @returns True if it's a valid PieceCID
 */
export function isPieceCID(cid: Link.Link): cid is PieceCID {
  return (
    typeof cid === 'object' && CID.asCID(cid) != null && cid.code === Raw.code && cid.multihash.code === Hasher.code
  )
}

/**
 * Calculate the PieceCID (Piece Commitment) for a given data blob
 *
 * @param data - The binary data to calculate the PieceCID for
 * @returns The calculated PieceCID CID
 */
export function calculate(data: Uint8Array): PieceCID {
  // TODO: consider https://github.com/storacha/fr32-sha2-256-trunc254-padded-binary-tree-multihash
  // for more efficient PieceCID calculation in WASM
  const hasher = Hasher.create()
  // We'll get slightly better performance by writing in chunks to let the
  // hasher do its work incrementally
  const chunkSize = 2048
  for (let i = 0; i < data.length; i += chunkSize) {
    hasher.write(data.subarray(i, i + chunkSize))
  }
  const digest = hasher.digest()
  return Link.create(Raw.code, digest) as PieceCID
}

/**
 * Calculate PieceCID from an async iterable of Uint8Array chunks.
 *
 * @param data - AsyncIterable yielding Uint8Array chunks
 * @returns Calculated PieceCID
 *
 * @example
 * const pieceCid = await calculateFromIterable(asyncIterableData)
 */
export async function calculateFromIterable(data: AsyncIterable<Uint8Array>): Promise<PieceCID> {
  const hasher = Hasher.create()

  for await (const chunk of data) {
    hasher.write(chunk)
  }

  const digest = hasher.digest()
  return Link.create(Raw.code, digest) as PieceCID
}

/**
 * Create a TransformStream that calculates PieceCID while streaming data through it
 * This allows calculating PieceCID without buffering the entire data in memory
 *
 * @returns An object with the TransformStream and a getPieceCID function to retrieve the result
 *
 * @example
 * const { stream, getPieceCID } = createPieceCIDStream()
 * await fetch(url, {
 *   method: 'PUT',
 *   body: dataStream.pipeThrough(stream)
 * })
 * const pieceCid = getPieceCID() // Available after stream completes
 */
export function createPieceCIDStream(): {
  stream: TransformStream<Uint8Array, Uint8Array>
  getPieceCID: () => PieceCID | null
} {
  const hasher = Hasher.create()
  let finished = false
  let pieceCid: PieceCID | null = null

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      // Write chunk to hasher for CommP calculation
      hasher.write(chunk)
      // Pass chunk through unchanged to continue upload
      controller.enqueue(chunk)
    },

    flush() {
      // Calculate final PieceCID when stream ends
      const digest = hasher.digest()
      pieceCid = Link.create(Raw.code, digest) as PieceCID
      finished = true
    },
  })

  return {
    stream,
    getPieceCID: () => {
      if (!finished) {
        return null
      }
      return pieceCid
    },
  }
}

/**
 * Convert Uint8Array to async iterable with optimal chunk size.
 *
 * Uses 2048-byte chunks for better hasher performance (determined by manual
 * testing with Node.js; this will likely vary by environment). This may not be
 * optimal for the streaming upload case, so further tuning may be needed to
 * find the best balance between hasher performance and upload chunk size.
 *
 * @param data - Uint8Array to convert
 * @param chunkSize - Size of chunks (default 2048)
 * @returns AsyncIterable yielding chunks
 */
export async function* uint8ArrayToAsyncIterable(
  data: Uint8Array,
  chunkSize: number = 2048
): AsyncIterable<Uint8Array> {
  for (let i = 0; i < data.length; i += chunkSize) {
    yield data.subarray(i, i + chunkSize)
  }
}

/**
 * Convert a hex representation of a PieceCID to a PieceCID object
 *
 * The contract stores the full PieceCID multihash digest (including height and padding)
 * The data comes as a hex string, we need to decode it as bytes then as a CID to get the PieceCID object
 *
 * @param pieceCidHex - The hex representation of the PieceCID
 * @returns {PieceCID} The PieceCID object
 */
export function hexToPieceCID(pieceCidHex: Hex | string): PieceCID {
  const pieceDataBytes = hexToBytes(pieceCidHex as Hex)
  const possiblePieceCID = CID.decode(pieceDataBytes)
  const isValid = isValidPieceCID(possiblePieceCID)
  if (!isValid) {
    throw new Error(`Hex string '${pieceCidHex}' is a valid CID but not a valid PieceCID`)
  }
  return possiblePieceCID as PieceCID
}

/**
 * Download data from a Response object, validate its PieceCID, and return as Uint8Array
 *
 * This function:
 * 1. Streams data from the Response body
 * 2. Calculates PieceCID during streaming
 * 3. Collects all chunks into a Uint8Array
 * 4. Validates the calculated PieceCID matches the expected value
 *
 * @param response - The Response object from a fetch() call
 * @param expectedPieceCid - The expected PieceCID to validate against
 * @returns The downloaded data as a Uint8Array
 * @throws Error if PieceCID validation fails or download errors occur
 *
 * @example
 * ```typescript
 * const response = await fetch(url)
 * const data = await downloadAndValidate(response, 'bafkzcib...')
 * ```
 */
export async function downloadAndValidate(
  response: Response,
  expectedPieceCid: string | PieceCID
): Promise<Uint8Array> {
  // Parse and validate the expected PieceCID
  const parsedPieceCid = asPieceCID(expectedPieceCid)
  if (parsedPieceCid == null) {
    throw new Error(`Invalid PieceCID: ${String(expectedPieceCid)}`)
  }

  // Check response is OK
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  if (response.body == null) {
    throw new Error('Response body is null')
  }

  // Create PieceCID calculation stream
  const { stream: pieceCidStream, getPieceCID } = createPieceCIDStream()

  // Create a stream that collects all chunks into an array
  const chunks: Uint8Array[] = []
  const collectStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      chunks.push(chunk)
      controller.enqueue(chunk)
    },
  })

  // Pipe the response through both streams
  const pipelineStream = response.body.pipeThrough(pieceCidStream).pipeThrough(collectStream)

  // Consume the stream to completion
  const reader = pipelineStream.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }

  if (chunks.length === 0) {
    throw new Error('Response body is empty')
  }

  // Get the calculated PieceCID
  const calculatedPieceCid = getPieceCID()

  if (calculatedPieceCid == null) {
    throw new Error('Failed to calculate PieceCID from stream')
  }

  // Verify the PieceCID
  if (calculatedPieceCid.toString() !== parsedPieceCid.toString()) {
    throw new Error(
      `PieceCID verification failed. Expected: ${String(parsedPieceCid)}, Got: ${String(calculatedPieceCid)}`
    )
  }

  // Combine all chunks into a single Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}
