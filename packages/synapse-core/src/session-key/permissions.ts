import { TypedData } from 'ox'
import type { Hex } from 'viem'
import { keccak256, stringToHex } from 'viem'
import { EIP712Types } from '../typed-data/type-definitions.ts'

export type SessionKeyPermissions = 'CreateDataSet' | 'AddPieces' | 'SchedulePieceRemovals' | 'DeleteDataSet'

function typeHash(type: TypedData.encodeType.Value) {
  return keccak256(stringToHex(TypedData.encodeType(type)))
}

/**
 * Session key permissions type hash map
 */
export const SESSION_KEY_PERMISSIONS: Record<SessionKeyPermissions, Hex> = {
  CreateDataSet: typeHash({
    types: EIP712Types,
    primaryType: 'CreateDataSet',
  }),
  AddPieces: typeHash({
    types: EIP712Types,
    primaryType: 'AddPieces',
  }),
  SchedulePieceRemovals: typeHash({
    types: EIP712Types,
    primaryType: 'SchedulePieceRemovals',
  }),
  DeleteDataSet: typeHash({
    types: EIP712Types,
    primaryType: 'DeleteDataSet',
  }),
}
