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

/**
 * Generate the EIP-712 type string for a given root type
 *
 * Creates a concatenated string of type definitions in the format required by EIP-712,
 * with all referenced types included alphabetically after the root type.
 *
 * @param rootType - The name of the root type from EIP712_TYPES
 * @returns The formatted EIP-712 type string
 * @throws Error if the root type doesn't exist in EIP712_TYPES
 *
 * @example
 * ```typescript
 * getEIP712TypeString('AddPieces')
 * ```
 */
export function getEIP712TypeString(rootType: string): string {
  if (!(rootType in EIP712_TYPES)) {
    throw new Error(`Type '${rootType}' does not exist in EIP712_TYPES`)
  }

  const typeMap = new Map<string, string>()

  // Recursively collect and build type strings
  const collectType = (typeName: string): void => {
    // Skip if already processed or not a custom type
    if (typeMap.has(typeName) || !(typeName in EIP712_TYPES)) return

    const args = EIP712_TYPES[typeName as keyof typeof EIP712_TYPES]

    const argStrings = args.map((arg) => `${arg.type} ${arg.name}`).join(',')
    typeMap.set(typeName, `${typeName}(${argStrings})`)

    // Recursively collect referenced custom types
    for (const arg of args) {
      const baseType = arg.type.endsWith('[]') ? arg.type.slice(0, -2) : arg.type
      collectType(baseType)
    }
  }

  collectType(rootType)

  // Build result: root type first, then others alphabetically (as per EIP-712)
  const rootString = typeMap.get(rootType)
  if (!rootString) {
    throw new Error(`Failed to build type string for ${rootType}`)
  }

  const otherStrings = Array.from(typeMap.entries())
    .filter(([name]) => name !== rootType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, str]) => str)
    .join('')

  return rootString + otherStrings
}
