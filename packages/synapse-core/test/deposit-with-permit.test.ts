import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { DepositAmountError, InsufficientBalanceError } from '../src/errors/pay.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { depositWithPermit } from '../src/pay/deposit-with-permit.ts'

describe('depositWithPermit', () => {
  const server = setup()

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  it('should throw DepositAmountError for zero amount', async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS.key1)
    const client = createWalletClient({
      account,
      chain: calibration,
      transport: http(),
    })

    await assert.rejects(() => depositWithPermit(client, { amount: 0n }), DepositAmountError)
  })

  it('should throw DepositAmountError for negative amount', async () => {
    const account = privateKeyToAccount(PRIVATE_KEYS.key1)
    const client = createWalletClient({
      account,
      chain: calibration,
      transport: http(),
    })

    await assert.rejects(() => depositWithPermit(client, { amount: -1n }), DepositAmountError)
  })

  it('should throw InsufficientBalanceError when balance is too low', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        erc20: {
          ...presets.basic.erc20,
          balanceOf: () => [parseUnits('10', 18)],
          nonces: () => [0n],
          name: () => ['USDFC'],
          version: () => ['1'],
        },
      })
    )

    const account = privateKeyToAccount(PRIVATE_KEYS.key1)
    const client = createWalletClient({
      account,
      chain: calibration,
      transport: http(),
    })

    await assert.rejects(() => depositWithPermit(client, { amount: parseUnits('100', 18) }), InsufficientBalanceError)
  })

  it('should send depositWithPermit transaction when balance is sufficient', async () => {
    let depositWithPermitCalled = false

    server.use(
      JSONRPC({
        ...presets.basic,
        erc20: {
          ...presets.basic.erc20,
          balanceOf: () => [parseUnits('200', 18)],
          nonces: () => [0n],
          name: () => ['USDFC'],
          version: () => ['1'],
        },
        payments: {
          ...presets.basic.payments,
          depositWithPermit: () => {
            depositWithPermitCalled = true
            return []
          },
        },
      })
    )

    const account = privateKeyToAccount(PRIVATE_KEYS.key1)
    const client = createWalletClient({
      account,
      chain: calibration,
      transport: http(),
    })

    const hash = await depositWithPermit(client, {
      amount: parseUnits('100', 18),
    })

    assert.equal(typeof hash, 'string')
    assert.ok(hash.startsWith('0x'))
    assert.equal(depositWithPermitCalled, true)
  })
})
