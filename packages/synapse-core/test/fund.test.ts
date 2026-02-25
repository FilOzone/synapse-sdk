import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createWalletClient, http, maxUint256, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { fund } from '../src/pay/fund.ts'
import { LOCKUP_PERIOD } from '../src/utils/constants.ts'

describe('fund', () => {
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

  it('should call depositWithPermitAndApproveOperator when needs approval and amount > 0', async () => {
    let depositAndApproveCalled = false

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
          // isFwssMaxApproved checks operatorApprovals
          operatorApprovals: () => [false, 0n, 0n, 0n, 0n, 0n],
          depositWithPermitAndApproveOperator: () => {
            depositAndApproveCalled = true
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

    const hash = await fund(client, { amount: parseUnits('100', 18) })

    assert.equal(typeof hash, 'string')
    assert.ok(hash.startsWith('0x'))
    assert.equal(depositAndApproveCalled, true)
  })

  it('should call setOperatorApproval when needs approval and amount === 0', async () => {
    let setOperatorApprovalCalled = false

    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [false, 0n, 0n, 0n, 0n, 0n],
          setOperatorApproval: () => {
            setOperatorApprovalCalled = true
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

    const hash = await fund(client, { amount: 0n })

    assert.equal(typeof hash, 'string')
    assert.ok(hash.startsWith('0x'))
    assert.equal(setOperatorApprovalCalled, true)
  })

  it('should call depositWithPermit when already approved and amount > 0', async () => {
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
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, LOCKUP_PERIOD],
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

    const hash = await fund(client, { amount: parseUnits('100', 18) })

    assert.equal(typeof hash, 'string')
    assert.ok(hash.startsWith('0x'))
    assert.equal(depositWithPermitCalled, true)
  })

  it('should return 0x when already approved and amount === 0', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, LOCKUP_PERIOD],
        },
      })
    )

    const account = privateKeyToAccount(PRIVATE_KEYS.key1)
    const client = createWalletClient({
      account,
      chain: calibration,
      transport: http(),
    })

    const hash = await fund(client, { amount: 0n })

    assert.equal(hash, '0x')
  })

  it('should use needsFwssMaxApproval override when provided (true)', async () => {
    let depositAndApproveCalled = false

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
          // Even though operatorApprovals says approved, the override forces approval flow
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, LOCKUP_PERIOD],
          depositWithPermitAndApproveOperator: () => {
            depositAndApproveCalled = true
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

    const hash = await fund(client, {
      amount: parseUnits('50', 18),
      needsFwssMaxApproval: true,
    })

    assert.equal(typeof hash, 'string')
    assert.equal(depositAndApproveCalled, true)
  })

  it('should use needsFwssMaxApproval override when provided (false)', async () => {
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
          // Even though operatorApprovals says not approved, the override skips approval
          operatorApprovals: () => [false, 0n, 0n, 0n, 0n, 0n],
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

    const hash = await fund(client, {
      amount: parseUnits('50', 18),
      needsFwssMaxApproval: false,
    })

    assert.equal(typeof hash, 'string')
    assert.equal(depositWithPermitCalled, true)
  })
})
