import _Eth from '@ledgerhq/hw-app-eth'
import type * as _LedgerTransport from '@ledgerhq/hw-transport'
import { TransportStatusError } from '@ledgerhq/hw-transport'
import {
  type Address,
  bytesToHex,
  getAddress,
  getTypesForEIP712Domain,
  type HashTypedDataParameters,
  type Hex,
  hashDomain,
  hashStruct,
  type LocalAccount,
  type NonceManager,
  serializeTransaction,
  stringToHex,
} from 'viem'
import { serializeSignature, toAccount } from 'viem/accounts'

export type LedgerTransportType = _LedgerTransport.default
export type LedgerEthAppType = _Eth.default
export type LedgerEthAppClass = typeof _Eth.default
export const Eth = _Eth as unknown as LedgerEthAppClass
export { TransportStatusError } from '@ledgerhq/hw-transport'

export interface DerivationPathParts {
  /** The account index to use in the path (`"m/44'/60'/${accountIndex}'/0/0"`). */
  accountIndex?: number | undefined
  /** The change index to use in the path (`"m/44'/60'/0'/${changeIndex}/0"`). */
  changeIndex?: number | undefined
  /** The address index to use in the path (`"m/44'/60'/0'/0/${addressIndex}"`). */
  addressIndex?: number | undefined
}

export interface LedgerToAccountParameters extends DerivationPathParts {
  /** The ledger transport to use. */
  transport: LedgerTransportType
  /** Whether to verify the address on the device. */
  verifyAddress?: boolean | undefined
  /** The nonce manager to use. */
  nonceManager?: NonceManager | undefined
  /** Whether to force blind signing. */
  forceBlindSigning?: boolean | undefined
}

export type LedgerAccount = LocalAccount<'ledger'>

interface MessageTypeProperty {
  name: string
  type: string
}

export const ensureLeading0x = (input: string): Address =>
  input.startsWith('0x') ? (input as Address) : (`0x${input}` as const)

export const trimLeading0x = (input: string) => (input.startsWith('0x') ? input.slice(2) : input)

/**
 * Convert a ledger transport to a viem account normally used together with `@ledgerhq/hw-transport-webhid` or `@ledgerhq/hw-transport-node-hid`
 *
 * Notice: Ledger packages need Buffer polyfill in the browser.
 *
 * @param parameters - The parameters for the ledger to account conversion {@link LedgerToAccountParameters}
 * @returns The viem account
 * @example
 * ```ts
 * import TransportWebHID from '@ledgerhq/hw-transport-webhid'
 * import { ledgerToAccount } from '@filoz/synapse-core/ledger'
 *
 * const transport = await TransportWebHID.create()
 * const account = await ledgerToAccount({
 *   transport,
 *   accountIndex: 0,
 *   addressIndex: 0,
 *   changeIndex: 0,
 * })
 *
 * await transport.close()
 * ```
 */
export async function ledgerToAccount({
  transport,
  accountIndex = 0,
  addressIndex = 0,
  changeIndex = 0,
  verifyAddress = false,
  nonceManager,
  forceBlindSigning = false,
}: LedgerToAccountParameters): Promise<LedgerAccount> {
  const path = `m/44'/60'/${accountIndex}'/${changeIndex}/${addressIndex}`
  let address: Address
  let publicKey: Hex
  let eth: LedgerEthAppType
  try {
    eth = new Eth(transport)
    const getAddressResult = await eth.getAddress(path, verifyAddress)
    address = getAddress(getAddressResult.address)
    publicKey = getAddressResult.publicKey as Hex
    const appConfig = await eth.getAppConfiguration()
    if (forceBlindSigning && appConfig.arbitraryDataEnabled === 0) {
      throw new Error('Blind signing is not enabled on your Ledger device')
    }
  } catch (error) {
    // Ledger device: UNKNOWN_ERROR (0x6511)
    if (error instanceof TransportStatusError && error.statusCode === 25873) {
      throw new Error('Open the Ethereum app on your Ledger device to continue')
    }
    throw error
  }

  const account = toAccount({
    address: ensureLeading0x(address),
    nonceManager,
    signMessage: async ({ message }) => {
      const _message = (() => {
        if (typeof message === 'string') return stringToHex(message)
        if (typeof message.raw === 'string') return message.raw
        return bytesToHex(message.raw)
      })()
      const { r, s, v } = await eth.signPersonalMessage(path, _message)
      return serializeSignature({ r: ensureLeading0x(r), s: ensureLeading0x(s), v: BigInt(v) })
    },
    signTransaction: async (tx) => {
      const serializedTx = serializeTransaction(tx)

      let { r, s, v: _v } = await eth.signTransaction(path, trimLeading0x(serializedTx), null)
      if (typeof _v === 'string' && (_v === '' || _v === '0x')) {
        _v = '0x0'
      }
      let v: bigint
      try {
        v = BigInt(typeof _v === 'string' ? ensureLeading0x(_v) : _v)
      } catch (err) {
        throw new Error(
          `Ledger signature \`v\` was malformed and couldn't be parsed \`${_v}\` (Original error: ${err})`
        )
      }

      return serializeTransaction(tx, {
        r: ensureLeading0x(r),
        s: ensureLeading0x(s),
        v,
      })
    },
    signTypedData: async (parameters) => {
      const { domain = {}, message, primaryType } = parameters as HashTypedDataParameters
      const types = {
        EIP712Domain: getTypesForEIP712Domain({ domain }),
        ...parameters.types,
      }

      const domainSeperator = hashDomain({
        domain,
        types: types as Record<string, MessageTypeProperty[]>,
      })

      const messageHash = hashStruct({
        data: message,
        primaryType,
        types: types as Record<string, MessageTypeProperty[]>,
      })

      const { r, s, v } = await eth.signEIP712HashedMessage(path, domainSeperator, messageHash)
      return serializeSignature({ r: ensureLeading0x(r), s: ensureLeading0x(s), v: BigInt(v) })
    },
  })

  return {
    ...account,
    publicKey: ensureLeading0x(publicKey),
    source: 'ledger',
  }
}
