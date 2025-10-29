import { defineConfig } from '@wagmi/cli'
import { fetch } from '@wagmi/cli/plugins'
import type { Address } from 'viem'

// GIT_REF can be one of: '<branch name>', '<commit>' or 'tags/<tag>'
const GIT_REF = '43e122981042a1498fc642d51376e8b70a760161'
const BASE_URL = `https://raw.githubusercontent.com/FilOzone/filecoin-services/${GIT_REF.replace(/^(?![a-f0-9]{40}$)/, 'refs/')}/service_contracts/abi`

const config = defineConfig(() => {
  const contracts = [
    {
      name: 'FilecoinPayV1',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x0000000000000000000000000000000000000000' as Address,
      },
    },
    {
      name: 'FilecoinWarmStorageService',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x0000000000000000000000000000000000000000' as Address,
      },
    },
    {
      name: 'FilecoinWarmStorageServiceStateView',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x0000000000000000000000000000000000000000' as Address,
      },
    },
    {
      name: 'PDPVerifier',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x0000000000000000000000000000000000000000' as Address,
      },
    },
    {
      name: 'ServiceProviderRegistry',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x0000000000000000000000000000000000000000' as Address,
      },
    },
    {
      name: 'SessionKeyRegistry',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x0000000000000000000000000000000000000000' as Address,
      },
    },
  ]

  return [
    {
      out: 'src/abis/gen.ts',
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
