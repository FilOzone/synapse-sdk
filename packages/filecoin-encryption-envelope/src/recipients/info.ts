import type { DecodedRecipient } from '../cose/decode.ts'
import type { CborValue } from '../cose/headers.ts'
import { MalformedEnvelopeError } from '../errors.ts'
import type { RecipientInfo } from './types.ts'

function snapshotCborValue(value: CborValue): CborValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value)
  }
  if (Array.isArray(value)) {
    return value.map(snapshotCborValue)
  }
  if (value instanceof Map) {
    const snapshot = new Map<CborValue, CborValue>()
    for (const [key, entryValue] of value) {
      snapshot.set(snapshotCborValue(key), snapshotCborValue(entryValue))
    }
    return snapshot
  }

  throw new MalformedEnvelopeError(
    'Recipient snapshot invariant violated: strict CBOR decoding produced a plain object instead of a Map.'
  )
}

function snapshotHeaderMap(source: Map<CborValue, CborValue>): Map<number | string, CborValue> {
  const snapshot = new Map<number | string, CborValue>()
  for (const [label, value] of source) {
    snapshot.set(label as number | string, snapshotCborValue(value))
  }
  return snapshot
}

/**
 * Build an isolated unwrapper view from a structurally validated recipient.
 * Decoded byte strings may share storage with the caller's encoded envelope;
 * copying lets an unwrapper clear key material without changing that input.
 */
export function toRecipientInfo(recipient: DecodedRecipient, index: number): RecipientInfo {
  const protectedMap = snapshotHeaderMap(recipient.protected)
  const unprotected = snapshotHeaderMap(recipient.unprotected)

  return {
    index,
    alg: recipient.alg,
    ...(recipient.kid === undefined ? {} : { kid: new Uint8Array(recipient.kid) }),
    protectedBytes: new Uint8Array(recipient.protectedBytes),
    protected: protectedMap,
    unprotected,
    wrappedKey: new Uint8Array(recipient.ciphertext),
  }
}
