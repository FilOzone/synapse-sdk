import { type Address, type Hex, isAddress, isHex } from 'viem'
import * as z from 'zod'
import { is as isPieceCID, from as pieceFrom } from '../piece/parse.ts'
import type { PieceCID } from '../piece/piece-cid.ts'

export const zHex = z.custom<Hex>((val) => {
  return typeof val === 'string' ? isHex(val) : false
}, 'Invalid hex value')

export const zAddress = z.custom<Address>((value) => {
  return typeof value === 'string' && isAddress(value)
}, 'Invalid address')

export const zAddressLoose = z.custom<Address>((value) => {
  return typeof value === 'string' && isAddress(value, { strict: false })
}, 'Invalid address')

export const zNumberToBigInt = z.codec(z.int(), z.bigint(), {
  decode: (num) => BigInt(num),
  encode: (bigint) => Number(bigint),
})

export const zPieceCid = z.custom<PieceCID>((val) => {
  try {
    return isPieceCID(val)
  } catch {
    return false
  }
}, 'Invalid PieceCID')

export const zPieceCidString = z.custom<string>((val) => {
  try {
    return typeof val === 'string' && pieceFrom(val) != null
  } catch {
    return false
  }
}, 'Invalid PieceCID string')

export const zStringToCid = z.codec(zPieceCidString, zPieceCid, {
  decode: (val) => pieceFrom(val),
  encode: (val) => val.toString(),
})
