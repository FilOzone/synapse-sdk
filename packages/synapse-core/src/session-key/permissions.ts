import { TypedData } from 'ox'
import type { Hex } from 'viem'
import { keccak256, stringToHex } from 'viem'
import { EIP712Types } from '../typed-data/type-definitions.ts'

export type SessionKeyPermissions = 'CreateDataSet' | 'AddPieces' | 'SchedulePieceRemovals' | 'DeleteDataSet'

function typeHash(type: TypedData.encodeType.Value) {
  return keccak256(stringToHex(TypedData.encodeType(type)))
}

export const EMPTY_EXPIRATIONS: Record<SessionKeyPermissions, bigint> = {
  CreateDataSet: 0n,
  AddPieces: 0n,
  SchedulePieceRemovals: 0n,
  DeleteDataSet: 0n,
}

export const ALL_PERMISSIONS: SessionKeyPermissions[] = [
  'CreateDataSet',
  'AddPieces',
  'SchedulePieceRemovals',
  'DeleteDataSet',
]

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

export const TYPE_HASH_TO_PERMISSION: Record<Hex, SessionKeyPermissions> = {
  [SESSION_KEY_PERMISSIONS.CreateDataSet]: 'CreateDataSet',
  [SESSION_KEY_PERMISSIONS.AddPieces]: 'AddPieces',
  [SESSION_KEY_PERMISSIONS.SchedulePieceRemovals]: 'SchedulePieceRemovals',
  [SESSION_KEY_PERMISSIONS.DeleteDataSet]: 'DeleteDataSet',
}

export function getPermissionFromTypeHash(typeHash: Hex): SessionKeyPermissions {
  const permission = TYPE_HASH_TO_PERMISSION[typeHash]
  if (!permission) {
    throw new Error(`Permission not found for type hash: ${typeHash}`)
  }
  return permission
}
