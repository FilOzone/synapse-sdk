import {
  type DerivationPathParts,
  Eth,
  type LedgerEthAppType,
  ledgerToAccount,
  TransportStatusError,
} from '@filoz/synapse-core/ledger'
import _TransportWebHID from '@ledgerhq/hw-transport-webhid'
import {
  ChainNotConfiguredError,
  type Connector,
  type ConnectorEventMap,
  type CreateConnectorFn,
  createConnector,
  type Storage,
  type Transport as WagmiTransport,
} from '@wagmi/core'
import type { Compute, Emitter } from '@wagmi/core/internal'
import { type Address, type Chain, createWalletClient, getAddress } from 'viem'

// needs buffer polyfill in vite config
export type TransportWebHIDClass = typeof _TransportWebHID.default
export const TransportWebHID = _TransportWebHID as unknown as TransportWebHIDClass

export interface LedgerParameters extends DerivationPathParts {
  /** Whether to verify the address on the device. */
  verifyAddress?: boolean | undefined
  /** Whether to force blind signing. */
  forceBlindSigning?: boolean | undefined
}

type StorageItem = {
  ledgerDevice: number
  recentConnectorId: string
  store: {
    state: {
      chainId: number
    }
  }
}
interface Config {
  chains: readonly [Chain, ...Chain[]]
  emitter: Emitter<ConnectorEventMap>
  storage?: Compute<Storage<StorageItem>> | null | undefined
  transports?: Record<number, WagmiTransport> | undefined
}

type Properties = {
  getEth(): Promise<LedgerEthAppType>
  onHidDisconnect(event: HIDConnectionEvent): Promise<void>
  changeAccount(parts?: DerivationPathParts): Promise<readonly Address[]>
}
export type LedgerConnector = Connector<CreateConnectorFn<unknown, Properties, Record<string, unknown>>>
export function asLedgerConnector(connector: Connector): LedgerConnector | undefined {
  if (connector.type !== 'ledger') {
    return undefined
  }
  return connector as LedgerConnector
}

export function isLedgerConnector(connector: Connector | undefined): connector is LedgerConnector {
  if (!connector) {
    return false
  }
  return connector.type === 'ledger'
}

async function getChain(config: Config, chainId: number | undefined) {
  if (!chainId) {
    const store = await config.storage?.getItem('store')
    if (store?.state?.chainId) {
      chainId = store?.state?.chainId
    } else {
      chainId = config.chains[0].id
    }
  }

  const chain = config.chains.find((chain) => chain.id === chainId)
  if (!chain) {
    throw new ChainNotConfiguredError()
  }
  return chain
}

async function findDevice(config: Config) {
  const devices = await TransportWebHID.list()
  const ledgerDevice = await config.storage?.getItem('ledgerDevice')

  return devices.find((device) => device.productId === ledgerDevice)
}

/**
 * Create a ledger connector
 *
 * Notice: Ledger packages need Buffer polyfill in the browser.
 */
export function ledger({
  accountIndex = 0,
  addressIndex = 0,
  changeIndex = 0,
  verifyAddress = false,
  forceBlindSigning = false,
}: LedgerParameters = {}) {
  let onHidDisconnect: Properties['onHidDisconnect'] | undefined
  let currentChainId: number | undefined
  let _eth: LedgerEthAppType | undefined
  let ethPromise: Promise<LedgerEthAppType> | undefined
  let path = `m/44'/60'/${accountIndex}'/${changeIndex}/${addressIndex}`

  return createConnector<unknown, Properties, StorageItem>((config) => {
    return {
      id: 'ledger',
      name: 'Ledger',
      type: 'ledger',

      async setup() {
        const isSupported = await TransportWebHID.isSupported()
        if (!isSupported) {
          throw new Error('Ledger is not supported')
        }
      },

      async connect({ chainId, withCapabilities } = {}) {
        const chain = await getChain(config, chainId)
        currentChainId = chain.id
        try {
          const eth = await this.getEth()
          const appConfig = await eth.getAppConfiguration()
          if (forceBlindSigning && appConfig.arbitraryDataEnabled === 0) {
            throw new Error('Blind signing is not enabled on your Ledger device')
          }

          if (!onHidDisconnect) {
            onHidDisconnect = this.onHidDisconnect.bind(this)
            navigator.hid.addEventListener('disconnect', onHidDisconnect)
          }

          const { address } = await eth.getAddress(path, verifyAddress, false, currentChainId?.toString())
          const _address = getAddress(address)
          config.emitter.emit('connect', { accounts: [_address], chainId: currentChainId })
          return {
            accounts: (withCapabilities ? [{ address: _address, capabilities: {} }] : [_address]) as never,
            chainId: currentChainId,
          }
        } catch (error) {
          // Ledger device: UNKNOWN_ERROR (0x6511)
          if (error instanceof TransportStatusError && error.statusCode === 25873) {
            throw new Error('Open the Ethereum app on your Ledger device to continue')
          }
          throw error
        }
      },

      async isAuthorized() {
        const device = await findDevice(config)
        const recentConnectorId = await config.storage?.getItem('recentConnectorId')

        if (device && recentConnectorId === 'ledger') {
          return true
        }
        return false
      },

      async disconnect() {
        const eth = await this.getEth()
        await eth.transport.close()
        _eth = undefined
        if (onHidDisconnect) {
          navigator.hid.removeEventListener('disconnect', onHidDisconnect)
          onHidDisconnect = undefined
        }
        await config.storage?.removeItem('ledgerDevice')
        const device = await findDevice(config)
        if (device) {
          await device.forget()
        }
      },

      async getClient(parameters?: { chainId?: number | undefined }) {
        const chain = await getChain(config, parameters?.chainId ?? currentChainId)
        const eth = await this.getEth()
        const viemTransport = config.transports?.[chain.id]
        if (!viemTransport) {
          throw new Error('Viem Transport not found')
        }
        return createWalletClient({
          transport: viemTransport,
          key: 'ledgerWallet',
          name: 'Ledger Wallet Client',
          chain,
          account: await ledgerToAccount({
            transport: eth.transport,
            accountIndex,
            addressIndex,
            changeIndex,
          }),
        })
      },

      async getAccounts() {
        const eth = await this.getEth()
        const { address } = await eth.getAddress(path, false, false, currentChainId?.toString())
        return [getAddress(address)]
      },

      async switchChain(parameters) {
        const chain = await getChain(config, parameters?.chainId ?? currentChainId)
        currentChainId = chain.id

        async function sendAndWaitForChangeEvent(chainId: number) {
          await new Promise<void>((resolve) => {
            const listener = ((data) => {
              if ('chainId' in data && data.chainId === chainId) {
                config.emitter.off('change', listener)
                resolve()
              }
            }) satisfies Parameters<typeof config.emitter.on>[1]
            config.emitter.on('change', listener)
            config.emitter.emit('change', { chainId })
          })
        }

        await sendAndWaitForChangeEvent(chain.id)
        return chain
      },

      async getChainId() {
        const chain = await getChain(config, currentChainId)
        return chain.id
      },

      async onHidDisconnect(event: HIDConnectionEvent) {
        const ledgerDevice = await config.storage?.getItem('ledgerDevice')
        if (ledgerDevice === event.device.productId) {
          await this.disconnect()
          await event.device.forget()
          config.emitter.emit('disconnect')
        }
      },

      async getEth() {
        async function init() {
          const transport = await TransportWebHID.create()
          // @ts-expect-error - transport.device is not typed
          config.storage?.setItem('ledgerDevice', transport.device.productId)
          const eth = new Eth(transport)
          return eth
        }

        if (!_eth) {
          if (!ethPromise) {
            ethPromise = init()
          }
          _eth = await ethPromise
          ethPromise = undefined
        }
        return _eth
      },
      async changeAccount({ accountIndex = 0, changeIndex = 0, addressIndex = 0 }: DerivationPathParts = {}) {
        path = `m/44'/60'/${accountIndex}'/${changeIndex}/${addressIndex}`
        const accounts = await this.getAccounts()

        config.emitter.emit('change', { accounts, chainId: currentChainId })
        return accounts
      },
      async getProvider() {
        return {}
      },
      onAccountsChanged() {
        // no-op
      },
      onChainChanged() {
        // no-op
      },
      async onDisconnect() {
        // no-op
      },
    }
  })
}
