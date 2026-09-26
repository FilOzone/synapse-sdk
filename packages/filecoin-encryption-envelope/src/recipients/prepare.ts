/** Validate recipient inputs and build their COSE records. */
import { A256KW_WRAPPED_CEK_SIZE, MAX_ENVELOPE_SIZE } from '../cose/constants.ts'
import type { RecipientInput } from '../cose/encode.ts'
import { describeCborType } from '../cose/headers.ts'
import { MalformedEnvelopeError } from '../errors.ts'
import { createA256KWRecipientRecord, type ParsedA256KWKey, parseA256KWRecipient } from './a256kw.ts'

/**
 * Read and validate all recipient inputs. Omission selects COSE_Encrypt0; an
 * empty list is always a caller error.
 */
export function prepareRecipientInputs(value: unknown): readonly ParsedA256KWKey[] | undefined {
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

  const recipients: ParsedA256KWKey[] = []
  let minimumPayloadSize = 0
  // Indexed, not `.map`: a sparse hole must be validated, not skipped.
  for (let index = 0; index < value.length; index++) {
    const recipient = parseA256KWRecipient(value[index], `recipients[${index}]`, MAX_ENVELOPE_SIZE - minimumPayloadSize)
    recipients.push(recipient)
    minimumPayloadSize += A256KW_WRAPPED_CEK_SIZE + (recipient.kid?.length ?? 0)
  }

  return recipients
}

/**
 * Wrap the CEK for each recipient and build its COSE record, in order.
 * Sequential, one recipient at a time: the envelope-size limit is the only
 * list-size limit, so this must not start every Web Crypto operation at once.
 */
export async function createRecipientRecords(
  cekKey: CryptoKey,
  recipients: readonly ParsedA256KWKey[]
): Promise<RecipientInput[]> {
  const records: RecipientInput[] = []
  for (const recipient of recipients) {
    records.push(await createA256KWRecipientRecord(cekKey, recipient))
  }
  return records
}
