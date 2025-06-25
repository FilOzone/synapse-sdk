/* globals beforeEach afterEach */
import sinon from 'sinon'

// Global sandbox for automatic cleanup
export function createSandbox (): sinon.SinonSandbox {
  return sinon.createSandbox()
}

// Common stub patterns
export function stubFetch (sandbox: sinon.SinonSandbox): sinon.SinonStub {
  // Use globalThis for cross-platform compatibility
  return sandbox.stub(globalThis as any, 'fetch')
}

export function stubFetchJson (sandbox: sinon.SinonSandbox, response: any, status = 200): sinon.SinonStub {
  return stubFetch(sandbox).resolves(
    new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  )
}

export function stubFetchError (sandbox: sinon.SinonSandbox, message: string): sinon.SinonStub {
  return stubFetch(sandbox).rejects(new Error(message))
}

// Re-export provider helpers
export { createMockProvider, createMockSigner, stubContractCall } from './sinon-provider.js'
export type { MockProviderConfig } from './sinon-provider.js'

// Service mock factories
export interface MockPandoraServiceConfig {
  clientProofSets?: any[]
  approvedProviders?: any[]
  nextClientDataSetId?: number
  providerIdByAddress?: Record<string, number>
  allowanceForStorage?: any
  addRootsInfo?: any
  servicePrice?: { basePrice: bigint, cdnPrice: bigint }
}

export function createMockPandoraService (sandbox: sinon.SinonSandbox, config: MockPandoraServiceConfig = {}): any {
  const emptyProviderMap: Record<string, number> = {}
  const defaults = {
    clientProofSets: [],
    approvedProviders: [],
    nextClientDataSetId: 1,
    providerIdByAddress: emptyProviderMap,
    allowanceForStorage: {
      rateAllowanceNeeded: BigInt(100),
      lockupAllowanceNeeded: BigInt(2880000),
      currentRateAllowance: BigInt(1000000),
      currentLockupAllowance: BigInt(10000000),
      currentRateUsed: BigInt(0),
      currentLockupUsed: BigInt(0),
      sufficient: true,
      message: undefined,
      costs: {
        perEpoch: BigInt(100),
        perDay: BigInt(28800),
        perMonth: BigInt(864000)
      }
    },
    addRootsInfo: {
      nextRootId: 0,
      clientDataSetId: 1,
      currentRootCount: 0
    },
    servicePrice: {
      basePrice: BigInt(1000),
      cdnPrice: BigInt(2000)
    }
  }

  const merged = { ...defaults, ...config }

  return {
    getClientProofSets: sandbox.stub().resolves(merged.clientProofSets),
    getClientProofSetsWithDetails: sandbox.stub().resolves(merged.clientProofSets),
    getAllApprovedProviders: sandbox.stub().resolves(merged.approvedProviders),
    getApprovedProvider: sandbox.stub().callsFake(async (id: number) => {
      const provider = merged.approvedProviders[id - 1]
      if (provider == null) {
        return {
          owner: '0x0000000000000000000000000000000000000000',
          pdpUrl: '',
          pieceRetrievalUrl: '',
          registeredAt: 0,
          approvedAt: 0
        }
      }
      return provider
    }),
    getProviderIdByAddress: sandbox.stub().callsFake(async (address: string) => {
      return merged.providerIdByAddress[address.toLowerCase()] ?? 0
    }),
    getNextClientDataSetId: sandbox.stub().resolves(merged.nextClientDataSetId),
    checkAllowanceForStorage: sandbox.stub().resolves(merged.allowanceForStorage),
    getAddRootsInfo: sandbox.stub().resolves(merged.addRootsInfo),
    getServicePrice: sandbox.stub().resolves(merged.servicePrice)
  }
}

export interface MockPDPServerConfig {
  proofSetId?: number
  pieceUploadResponse?: any
  findPieceResponse?: any
  addRootsResponse?: any
  rootAdditionStatus?: any
  proofSetDetails?: any
}

export function createMockPDPServer (sandbox: sinon.SinonSandbox, config: MockPDPServerConfig = {}): any {
  const defaults = {
    proofSetId: 123,
    pieceUploadResponse: {
      commP: 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq',
      size: 65
    },
    findPieceResponse: { uuid: 'test-uuid' },
    addRootsResponse: { message: 'success' },
    rootAdditionStatus: {
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      txStatus: 'confirmed',
      proofSetId: 123,
      rootCount: 1,
      addMessageOk: true,
      confirmedRootIds: [0]
    },
    proofSetDetails: {
      proofSetId: 123,
      payer: '0x1234567890123456789012345678901234567890',
      payee: '0xabcdef1234567890123456789012345678901234'
    }
  }

  const merged = { ...defaults, ...config }

  return {
    createProofSet: sandbox.stub().resolves({ proofSetId: merged.proofSetId }),
    uploadPiece: sandbox.stub().resolves(merged.pieceUploadResponse),
    findPiece: sandbox.stub().resolves(merged.findPieceResponse),
    addRoots: sandbox.stub().resolves(merged.addRootsResponse),
    getRootAdditionStatus: sandbox.stub().resolves(merged.rootAdditionStatus),
    getProofSetDetails: sandbox.stub().resolves(merged.proofSetDetails),
    baseURL: 'https://pdp.example.com'
  }
}

// Callback testing helpers
export function createCallbackSpy (sandbox: sinon.SinonSandbox, name?: string): sinon.SinonSpy {
  const spy = sandbox.spy((...args: any[]) => {
    // Optional: log for debugging
    // Use globalThis check for cross-platform compatibility
    if (name != null && typeof globalThis !== 'undefined' &&
        'process' in globalThis &&
        (globalThis as any).process?.env?.DEBUG_CALLBACKS === 'true') {
      console.log(`${name} called with:`, args)
    }
  })
  return spy
}

export function assertCallbackSequence (
  callbacks: Record<string, sinon.SinonSpy>,
  expectedOrder: string[]
): void {
  expectedOrder.forEach((name, index) => {
    const spy = callbacks[name]
    if (spy == null) {
      throw new Error(`Callback '${name}' not found in callbacks object`)
    }
    if (!spy.called) {
      throw new Error(`Callback '${name}' was not called`)
    }
    if (index > 0) {
      const prevName = expectedOrder[index - 1]
      const prevSpy = callbacks[prevName]
      if (!spy.calledAfter(prevSpy)) {
        throw new Error(`Callback '${name}' should be called after '${prevName}'`)
      }
    }
  })
}

export function createCallOrderTracker (sandbox: sinon.SinonSandbox): {
  track: (name: string) => sinon.SinonSpy
  getOrder: () => string[]
  assertOrder: (expected: string[]) => void
} {
  const order: string[] = []
  const spies: Record<string, sinon.SinonSpy> = {}

  return {
    track: (name: string) => {
      const spy = sandbox.spy(() => {
        order.push(name)
      })
      spies[name] = spy
      return spy
    },
    getOrder: () => order,
    assertOrder: (expected: string[]) => {
      if (order.length !== expected.length) {
        throw new Error(`Expected ${expected.length} calls but got ${order.length}. Actual order: ${order.join(', ')}`)
      }
      expected.forEach((name, index) => {
        if (order[index] !== name) {
          throw new Error(`Expected '${name}' at position ${index} but got '${order[index]}'. Full order: ${order.join(', ')}`)
        }
      })
    }
  }
}

// Setup/teardown helpers for Mocha
export function useSinon (): () => sinon.SinonSandbox {
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  return () => sandbox
}

// Fake timer helpers
export interface FakeTimerConfig {
  now?: number | Date
  toFake?: Array<'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'Date' | 'nextTick' | 'queueMicrotask'>
  shouldAdvanceTime?: boolean
  advanceTimeDelta?: number
}

export function useFakeTimers (sandbox: sinon.SinonSandbox, config: FakeTimerConfig = {}): sinon.SinonFakeTimers {
  const defaults: FakeTimerConfig = {
    now: Date.now(),
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    shouldAdvanceTime: false,
    advanceTimeDelta: 20
  }

  const options = { ...defaults, ...config }
  const clock = sandbox.useFakeTimers({
    now: options.now,
    toFake: options.toFake,
    shouldAdvanceTime: options.shouldAdvanceTime,
    advanceTimeDelta: options.advanceTimeDelta
  })

  return clock
}

// Helper to advance time in steps, allowing promises to resolve
export async function advanceTimeInSteps (clock: sinon.SinonFakeTimers, totalTime: number, stepTime: number = 10): Promise<void> {
  const steps = Math.ceil(totalTime / stepTime)
  for (let i = 0; i < steps; i++) {
    await clock.tickAsync(stepTime)
  }
}
