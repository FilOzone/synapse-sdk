import type { TypedDataToPrimitiveTypes } from 'abitype'
import type { Address } from 'viem'
import type { Chain } from '../chains.ts'

// EIP-712 Type definitions
export const EIP712Types = {
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
    { name: 'nonce', type: 'uint256' },
    { name: 'pieceData', type: 'Cid[]' },
    { name: 'pieceMetadata', type: 'PieceMetadata[]' },
  ],
  SchedulePieceRemovals: [
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'pieceIds', type: 'uint256[]' },
  ],
  DeleteDataSet: [{ name: 'clientDataSetId', type: 'uint256' }],

  /**
   * ERC-2612: Permit Extension for EIP-20 Signed Approvals
   * @see https://eips.ethereum.org/EIPS/eip-2612
   */
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export type MetadataEntry = TypedDataType['MetadataEntry']

export type TypedDataType = TypedDataToPrimitiveTypes<typeof EIP712Types>

export interface GetStorageDomainOptions {
  /**
   * The chain id to use.
   */
  chain: Chain
  /**
   * The verifying contract to use. If not provided, the default is the FilecoinWarmStorageService contract address.
   */
  verifyingContract?: Address
}

export function getStorageDomain(options: GetStorageDomainOptions) {
  return {
    name: 'FilecoinWarmStorageService',
    version: '1',
    chainId: options.chain.id,
    verifyingContract: options.verifyingContract ?? options.chain.contracts.storage.address,
  }
}
