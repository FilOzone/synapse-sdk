import { type Hex, isHex } from 'viem'
import * as z from 'zod'
import { isPieceCID, type PieceCID, parse } from '../piece.ts'

export const zHex = z.custom<Hex>((val) => {
  return typeof val === 'string' ? isHex(val) : false
}, 'Invalid hex value')

export const zNumberToBigInt = z.codec(z.int(), z.bigint(), {
  decode: (num) => BigInt(num),
  encode: (bigint) => Number(bigint),
})

export const zPieceCid = z.custom<PieceCID>((val) => {
  try {
    return isPieceCID(val as PieceCID)
  } catch {
    return false
  }
}, 'Invalid PieceCID')

export const zPieceCidString = z.custom<string>((val) => {
  try {
    return typeof val === 'string' && parse(val)
  } catch {
    return false
  }
}, 'Invalid PieceCID string')

export const zStringToCid = z.codec(zPieceCidString, zPieceCid, {
  decode: (val) => parse(val),
  encode: (val) => val.toString(),
})
