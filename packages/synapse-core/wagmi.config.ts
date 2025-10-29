import { defineConfig } from '@wagmi/cli'
import { fetch } from '@wagmi/cli/plugins'
import type { Address } from 'viem'

// GIT_REF can be one of: '<branch name>', '<commit>' or 'tags/<tag>'
const GIT_REF = '43e122981042a1498fc642d51376e8b70a760161'
const BASE_URL = `https://raw.githubusercontent.com/FilOzone/filecoin-services/${GIT_REF.replace(/^(?![a-f0-9]{40}$)/, 'refs/')}/service_contracts/abi`

const config: ReturnType<typeof defineConfig> = defineConfig(() => {
  const contracts = [
    {
      name: 'FilecoinPayV1',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x09a0fDc2723fAd1A7b8e3e00eE5DF73841df55a0' as Address,
      },
    },
    {
      name: 'FilecoinWarmStorageService',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x02925630df557F957f70E112bA06e50965417CA0' as Address,
      },
    },
    {
      name: 'Errors',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x0000000000000000000000000000000000000000' as Address,
      },
    },
    {
      name: 'FilecoinWarmStorageServiceStateView',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0xA5D87b04086B1d591026cCE10255351B5AA4689B' as Address,
      },
    },
    {
      name: 'PDPVerifier',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C' as Address,
      },
    },
    {
      name: 'ServiceProviderRegistry',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x839e5c9988e4e9977d40708d0094103c0839Ac9D' as Address,
      },
    },
    {
      name: 'SessionKeyRegistry',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x97Dd879F5a97A8c761B94746d7F5cfF50AAd4452' as Address,
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
