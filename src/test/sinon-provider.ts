/**
 * Sinon-based provider mock factory
 */

import sinon from 'sinon'
import { ethers } from 'ethers'

export interface MockProviderConfig {
  chainId?: number
  network?: string
  blockNumber?: number
  balance?: bigint
  // Contract-specific responses
  pandoraPrices?: {
    pricePerTiBPerMonth?: bigint
    pricePerTiBPerMonthWithCDN?: bigint
    tokenAddress?: string
    epochsPerMonth?: bigint
  }
  accountFunds?: bigint
  tokenBalance?: bigint
  railIds?: {
    byPayer?: bigint[]
    byPayee?: bigint[]
  }
}

export function createMockProvider (sandbox: sinon.SinonSandbox, config: MockProviderConfig = {}): ethers.Provider {
  const {
    chainId = 314159,
    network = 'calibration',
    blockNumber = 1000000,
    balance = ethers.parseEther('100'),
    pandoraPrices = {
      pricePerTiBPerMonth: ethers.parseUnits('2', 18),
      pricePerTiBPerMonthWithCDN: ethers.parseUnits('3', 18),
      tokenAddress: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
      epochsPerMonth: 86400n
    },
    accountFunds = ethers.parseUnits('500', 18),
    tokenBalance = ethers.parseUnits('1000', 18),
    railIds = {
      byPayer: [1n, 2n],
      byPayee: [3n, 4n]
    }
  } = config

  const networkObj = new ethers.Network(network, chainId)

  const provider: any = {
    getNetwork: sandbox.stub().resolves(networkObj),
    getBlockNumber: sandbox.stub().resolves(blockNumber),
    getBalance: sandbox.stub().resolves(balance),
    getTransactionCount: sandbox.stub().resolves(0),
    getBlock: sandbox.stub().callsFake(async () => ({
      number: blockNumber,
      timestamp: Math.floor(Date.now() / 1000),
      hash: '0x' + Math.random().toString(16).substring(2).padEnd(64, '0')
    })),
    getFeeData: sandbox.stub().resolves({
      gasPrice: ethers.parseUnits('5', 'gwei'),
      maxFeePerGas: ethers.parseUnits('20', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei')
    }),
    estimateGas: sandbox.stub().resolves(21000n),
    getTransaction: sandbox.stub().resolves(null),
    getTransactionReceipt: sandbox.stub().resolves(null),
    getSigner: sandbox.stub().callsFake(async function () {
      const signer = createMockSigner(sandbox, '0x1234567890123456789012345678901234567890')
      ;(signer as any).provider = provider
      return signer
    }),
    sendTransaction: sandbox.stub().callsFake(async (transaction: any) => {
      const hash = '0x' + Math.random().toString(16).substring(2).padEnd(64, '0')
      return {
        hash,
        from: transaction.from ?? '',
        to: transaction.to ?? null,
        data: transaction.data ?? '',
        value: transaction.value ?? 0n,
        chainId: BigInt(chainId),
        gasLimit: 100000n,
        gasPrice: 1000000000n,
        nonce: 0,
        wait: sandbox.stub().resolves({
          hash,
          from: transaction.from ?? '',
          to: transaction.to ?? null,
          contractAddress: null,
          index: 0,
          root: '',
          gasUsed: 50000n,
          gasPrice: 1000000000n,
          cumulativeGasUsed: 50000n,
          effectiveGasPrice: 1000000000n,
          logsBloom: '',
          blockHash: '',
          blockNumber,
          logs: [],
          status: 1
        })
      } as any
    }),
    on: sandbox.stub(),
    removeListener: sandbox.stub(),

    // The call method uses Sinon's conditional stubbing
    call: sandbox.stub()
  }

  // Set up conditional responses for contract calls
  // Pandora getServicePrice (0x5482bdf9)
  provider.call.withArgs(sinon.match(tx => tx.data?.startsWith('0x5482bdf9'))).resolves(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(uint256,uint256,address,uint256)'],
      [[pandoraPrices.pricePerTiBPerMonth, pandoraPrices.pricePerTiBPerMonthWithCDN, pandoraPrices.tokenAddress, pandoraPrices.epochsPerMonth]]
    )
  )

  // Token balanceOf (0x70a08231)
  provider.call.withArgs(sinon.match(tx => tx.data?.includes('70a08231'))).resolves(
    ethers.zeroPadValue(ethers.toBeHex(tokenBalance), 32)
  )

  // Token decimals (0x313ce567)
  provider.call.withArgs(sinon.match(tx => tx.data?.includes('313ce567'))).resolves(
    ethers.zeroPadValue(ethers.toBeHex(18), 32)
  )

  // Token allowance (0xdd62ed3e)
  provider.call.withArgs(sinon.match(tx => tx.data?.includes('dd62ed3e'))).resolves(
    ethers.zeroPadValue(ethers.toBeHex(0), 32)
  )

  // Token approve (0x095ea7b3)
  provider.call.withArgs(sinon.match(tx => tx.data?.includes('095ea7b3'))).resolves(
    ethers.zeroPadValue(ethers.toBeHex(1), 32)
  )

  // Payments accounts (0xad74b775)
  provider.call.withArgs(sinon.match(tx => tx.data?.includes('ad74b775'))).resolves(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'uint256', 'uint256', 'uint256'],
      [accountFunds, 0n, 0n, blockNumber]
    )
  )

  // getRailsByPayer (0x89c6a46f)
  provider.call.withArgs(sinon.match(tx => tx.data?.includes('89c6a46f'))).resolves(
    ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [railIds.byPayer])
  )

  // getRailsByPayee (0x7a8fa2f1)
  provider.call.withArgs(sinon.match(tx => tx.data?.includes('7a8fa2f1'))).resolves(
    ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [railIds.byPayee])
  )

  // operatorApprovals (0xe3d4c69e)
  provider.call.withArgs(sinon.match(tx => tx.data?.includes('e3d4c69e'))).resolves(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bool', 'uint256', 'uint256', 'uint256', 'uint256'],
      [false, 0n, 0n, 0n, 0n] // isApproved, rateAllowance, rateUsed, lockupAllowance, lockupUsed
    )
  )

  // Default response for unknown calls
  provider.call.resolves('0x')

  // Configure event handling
  provider.on.callsFake((event: string, listener: (...args: any[]) => void) => {
    // Immediately fire block event for transaction waits
    if (event === 'block') {
      setTimeout(() => listener(blockNumber + 1), 0)
    }
    return provider
  })
  provider.removeListener.returns(provider)

  return provider as ethers.Provider
}

// Helper to set up specific contract responses
export function stubContractCall (
  provider: any,
  methodSelector: string,
  response: any,
  matcher?: (tx: any) => boolean
): void {
  const stub = provider.call as sinon.SinonStub
  if (matcher != null) {
    stub.withArgs(sinon.match(matcher)).resolves(response)
  } else {
    stub.withArgs(sinon.match(tx => tx.data?.includes(methodSelector))).resolves(response)
  }
}

// Helper to create a mock signer with Sinon
export function createMockSigner (sandbox: sinon.SinonSandbox, address: string = '0x1234567890123456789012345678901234567890'): ethers.Signer {
  const signer: any = {
    getAddress: sandbox.stub().resolves(address),
    signTransaction: sandbox.stub().resolves('0xsignedtransaction'),
    signMessage: sandbox.stub().resolves('0xsignedmessage'),
    signTypedData: sandbox.stub().resolves('0xsignedtypeddata'),
    sendTransaction: sandbox.stub().callsFake(async (transaction: any) => {
      if (signer.provider != null) {
        return signer.provider.sendTransaction(transaction)
      }
      throw new Error('No provider for sendTransaction')
    }),
    connect: sandbox.stub().callsFake((provider: any) => {
      const newSigner = createMockSigner(sandbox, address)
      ;(newSigner as any).provider = provider
      return newSigner
    }),
    provider: null
  }

  return signer as ethers.Signer
}
