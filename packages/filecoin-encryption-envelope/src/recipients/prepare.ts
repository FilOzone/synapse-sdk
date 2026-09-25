/** Validate recipient inputs, snapshot their key material, and build COSE records. */
import { MAX_ENVELOPE_SIZE } from '../cose/constants.ts'
import type { RecipientInput } from '../cose/encode.ts'
import { describeCborType } from '../cose/headers.ts'
import { MalformedEnvelopeError } from '../errors.ts'
import {
  createA256KWRecipientRecord,
  type ParsedA256KWRecipient,
  parseA256KWRecipient,
  WRAPPED_CEK_SIZE,
} from './a256kw.ts'

/**
 * Library-owned recipient inputs. Key copies remain private and are cleared
 * after records are built or when the caller's operation ends early.
 */
export interface PreparedRecipientInputs {
  /** Consume the prepared inputs once, clearing their KEKs after use. */
  buildRecords(cek: Uint8Array): Promise<RecipientInput[]>
  clear(): void
}

/**
 * Read, validate, and copy all recipient inputs before an asynchronous step.
 * Omission selects COSE_Encrypt0; an empty list is always a caller error.
 */
export function prepareRecipientInputs(value: unknown): PreparedRecipientInputs | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new MalformedEnvelopeError(`Invalid recipients: expected an array, got ${describeCborType(value)}.`)
  }
  if (value.length === 0) {
    throw new MalformedEnvelopeError(
      'Invalid recipients: an empty array is not a request for COSE_Encrypt0. Omit the field or supply at least one recipient.'
    )
  }

  const recipients: ParsedA256KWRecipient[] = []
  let minimumPayloadSize = 0
  const clear = () => {
    for (const recipient of recipients) {
      recipient.kek.fill(0)
    }
  }

  try {
    // Indexed, not `.map`: a sparse hole must be validated, not skipped.
    for (let index = 0; index < value.length; index++) {
      const recipient = parseA256KWRecipient(
        value[index],
        `recipients[${index}]`,
        MAX_ENVELOPE_SIZE - minimumPayloadSize
      )
      recipients.push(recipient)
      minimumPayloadSize += WRAPPED_CEK_SIZE + (recipient.kid?.length ?? 0)
    }
  } catch (error) {
    clear()
    throw error
  }

  return {
    async buildRecords(cek): Promise<RecipientInput[]> {
      try {
        const records: RecipientInput[] = []
        // Keep work bounded: the envelope-size limit is the only list-size
        // limit, so do not start every Web Crypto operation at once.
        for (const recipient of recipients) {
          records.push(await createA256KWRecipientRecord(cek, recipient))
        }
        return records
      } finally {
        clear()
      }
    },
    clear,
  }
}
