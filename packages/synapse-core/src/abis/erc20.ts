import { erc20Abi } from 'viem'

export { erc20Abi as erc20 } from 'viem'

/**
 * ERC20 ABI with Permit extension
 * @see https://eips.ethereum.org/EIPS/eip-2612
 */
export const erc20WithPermit = [
  ...erc20Abi,
  ...[
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
  ],
] as const
