import { defineConfig } from '@wagmi/cli'
import { fetch } from '@wagmi/cli/plugins'
import type { Address } from 'viem'

const GIT_REF = 'tags/alpha/calibnet/0x80617b65FD2EEa1D7fDe2B4F85977670690ed348-v2'
const BASE_URL = `https://raw.githubusercontent.com/FilOzone/filecoin-services/refs/${GIT_REF}/service_contracts/abi`

const config = defineConfig(() => {
  const contracts = [
    {
      name: 'Payments',
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
