import { defineConfig } from '@wagmi/cli'
import { fetch } from '@wagmi/cli/plugins'
import { type Address, type Chain, type Client, createClient, http, type Transport } from 'viem'
import { multicall } from 'viem/actions'
import { calibration } from './src/chains.ts'

// GIT_REF can be one of: '<branch name>', '<commit>' or 'tags/<tag>'
const GIT_REF = '8e162d676f3e83c495f104989b3014b3961e2f05'
const BASE_URL = `https://raw.githubusercontent.com/FilOzone/filecoin-services/${GIT_REF.replace(/^(?![a-f0-9]{40}$)/, 'refs/')}/service_contracts/abi`
const FWSS_ADDRESS = '0x02925630df557F957f70E112bA06e50965417CA0' as Address
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

async function readAddresses(client: Client<Transport, Chain>) {
  const abi = [
    {
      type: 'function',
      inputs: [],
      name: 'paymentsContractAddress',
      outputs: [{ name: '', internalType: 'address', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      inputs: [],
      name: 'pdpVerifierAddress',
      outputs: [{ name: '', internalType: 'address', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      inputs: [],
      name: 'serviceProviderRegistry',
      outputs: [
        {
          name: '',
          internalType: 'contract ServiceProviderRegistry',
          type: 'address',
        },
      ],
      stateMutability: 'view',
    },
    {
      type: 'function',
      inputs: [],
      name: 'sessionKeyRegistry',
      outputs: [
        {
          name: '',
          internalType: 'contract SessionKeyRegistry',
          type: 'address',
        },
      ],
      stateMutability: 'view',
    },
    {
      type: 'function',
      inputs: [],
      name: 'viewContractAddress',
      outputs: [{ name: '', internalType: 'address', type: 'address' }],
      stateMutability: 'view',
    },
  ] as const
  const addresses = await multicall(client, {
    allowFailure: false,
    contracts: [
      {
        address: FWSS_ADDRESS,
        abi,
        functionName: 'paymentsContractAddress',
      },
      {
        address: FWSS_ADDRESS,
        abi,
        functionName: 'viewContractAddress',
      },
      {
        address: FWSS_ADDRESS,
        abi,
        functionName: 'pdpVerifierAddress',
      },
      {
        address: FWSS_ADDRESS,
        abi,
        functionName: 'serviceProviderRegistry',
      },
      {
        address: FWSS_ADDRESS,
        abi,
        functionName: 'sessionKeyRegistry',
      },
    ],
  })
  return {
    payments: addresses[0],
    warmStorageView: addresses[1],
    pdpVerifier: addresses[2],
    serviceProviderRegistry: addresses[3],
    sessionKeyRegistry: addresses[4],
  }
}

const calibrationClient = createClient({
  chain: calibration,
  transport: http(),
})

const config: ReturnType<typeof defineConfig> = defineConfig(async () => {
  const calibrationAddresses = await readAddresses(calibrationClient)
  const contracts = [
    {
      name: 'Errors',
      address: {
        314: ZERO_ADDRESS,
        314159: ZERO_ADDRESS,
      },
    },
    {
      name: 'FilecoinWarmStorageService',
      address: {
        314: ZERO_ADDRESS,
        314159: FWSS_ADDRESS as Address,
      },
    },
    {
      name: 'FilecoinPayV1',
      address: {
        314: ZERO_ADDRESS,
        314159: calibrationAddresses.payments,
      },
    },
    {
      name: 'FilecoinWarmStorageServiceStateView',
      address: {
        314: ZERO_ADDRESS,
        314159: calibrationAddresses.warmStorageView,
      },
    },
    {
      name: 'PDPVerifier',
      address: {
        314: ZERO_ADDRESS,
        314159: calibrationAddresses.pdpVerifier,
      },
    },
    {
      name: 'ServiceProviderRegistry',
      address: {
        314: ZERO_ADDRESS,
        314159: calibrationAddresses.serviceProviderRegistry,
      },
    },
    {
      name: 'SessionKeyRegistry',
      address: {
        314: ZERO_ADDRESS,
        314159: calibrationAddresses.sessionKeyRegistry,
      },
    },
  ]

  return [
    {
      out: 'src/abis/generated.ts',
      plugins: [
        fetch({
          contracts,

          cacheDuration: 100,
          request(contract) {
            return {
              url: `${BASE_URL}/${contract.name}.abi.json`,
            }
          },
        }),
      ],
    },
  ]
})

export default config
