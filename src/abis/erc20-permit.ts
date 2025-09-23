export const erc20PermitAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'nonces',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'version',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const
