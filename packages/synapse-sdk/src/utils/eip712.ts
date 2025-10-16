import { TypedData } from 'ox'
import { keccak256, stringToHex } from 'viem'

/**
 * EIP-712 Type definitions for PDP operations verified by WarmStorage.
 */
export const EIP712_TYPES = {
  MetadataEntry: [
    { name: 'key', type: 'string' },
    { name: 'value', type: 'string' },
  ],
  CreateDataSet: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'payee', type: 'address' },
    { name: 'metadata', type: 'MetadataEntry[]' },
  ],
  Cid: [{ name: 'data', type: 'bytes' }],
  PieceMetadata: [
    { name: 'pieceIndex', type: 'uint256' },
    { name: 'metadata', type: 'MetadataEntry[]' },
  ],
  AddPieces: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'firstAdded', type: 'uint256' },
    { name: 'pieceData', type: 'Cid[]' },
    { name: 'pieceMetadata', type: 'PieceMetadata[]' },
  ],
  SchedulePieceRemovals: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'pieceIds', type: 'uint256[]' },
  ],
  DeleteDataSet: [{ name: 'clientDataSetId', type: 'uint256' }],
}

export const EIP712_ENCODED_TYPES: Record<string, string> = {}
export const EIP712_TYPE_HASHES: Record<string, string> = {}

for (const typeName in EIP712_TYPES) {
  const encodedType = TypedData.encodeType({
    types: EIP712_TYPES,
    primaryType: typeName,
  })
  EIP712_ENCODED_TYPES[typeName] = encodedType
  EIP712_TYPE_HASHES[typeName] = keccak256(stringToHex(encodedType))
}
