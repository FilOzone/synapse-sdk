import { TypedData } from 'ox'
import type { Tagged } from 'type-fest'
import type { Hex } from 'viem'
import { keccak256, stringToHex } from 'viem'
import { EIP712Types } from '../typed-data/type-definitions.ts'

export type CreateDataSetPermission = Tagged<Hex, 'CreateDataSetPermission'>
export type AddPiecesPermission = Tagged<Hex, 'AddPiecesPermission'>
export type SchedulePieceRemovalsPermission = Tagged<Hex, 'SchedulePieceRemovalsPermission'>

function typeHash(type: TypedData.encodeType.Value) {
  return keccak256(stringToHex(TypedData.encodeType(type)))
}

export const CreateDataSetPermission = typeHash({
  types: EIP712Types,
  primaryType: 'CreateDataSet',
}) as CreateDataSetPermission

export const AddPiecesPermission = typeHash({
  types: EIP712Types,
  primaryType: 'AddPieces',
}) as AddPiecesPermission

export const SchedulePieceRemovalsPermission = typeHash({
  types: EIP712Types,
  primaryType: 'SchedulePieceRemovals',
}) as SchedulePieceRemovalsPermission

export const DefaultFwssPermissions = [CreateDataSetPermission, AddPiecesPermission, SchedulePieceRemovalsPermission]

export type Permission = CreateDataSetPermission | AddPiecesPermission | SchedulePieceRemovalsPermission | Hex

export type Expirations = {
  [key in Permission]: bigint
}

export const DefaultEmptyExpirations: Expirations = {
  [CreateDataSetPermission]: 0n,
  [AddPiecesPermission]: 0n,
  [SchedulePieceRemovalsPermission]: 0n,
}
