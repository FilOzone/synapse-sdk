import type { Account, Address, Chain, Client, Transport } from 'viem'
import { signTypedData } from 'viem/actions'
import { getChain } from '../chains.ts'
import { EIP712Types } from './type-definitions.ts'

export type SignErc20PermitOptions = {
  /**
   * The address of the token to approve.
   */
  token?: Address
  /**
   * The address of the spender.
   */
  spender?: Address
  /**
   * The amount to approve.
   */
  amount: bigint
  /**
   * The nonce of the token.
   */
  nonce: bigint
  /**
   * The deadline of the permit.
   */
  deadline: bigint
  /**
   * The name of the token.
   */
  name: string
  /**
   * The version of the token.
   */
  version: string
}

/**
 * Sign the ERC20 permit message
 *
 * @param client - The client to use to sign the message.
 * @param options - The options for the ERC20 permit message.
 */
export async function signErc20Permit(client: Client<Transport, Chain, Account>, options: SignErc20PermitOptions) {
  const chain = getChain(client.chain.id)
  const { amount, nonce, deadline, name, version } = options

  const spender = options.spender ?? chain.contracts.payments.address
  const token = options.token ?? chain.contracts.usdfc.address

  const domain = {
    chainId: client.chain.id,
    name: name,
    version: version,
    verifyingContract: token,
  }
  const message = {
    owner: client.account.address,
    spender: spender,
    value: amount,
    nonce: nonce,
    deadline: deadline,
  }
  const signature = await signTypedData(client, {
    account: client.account,
    domain,
    types: EIP712Types,
    primaryType: 'Permit',
    message,
  })

  return signature
}
