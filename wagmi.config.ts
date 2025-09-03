import { defineConfig } from '@wagmi/cli'
import { fetch } from '@wagmi/cli/plugins'
import type { Address } from 'viem'

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
            const baseUrl =
              'https://raw.githubusercontent.com/FilOzone/filecoin-services/refs/heads/main/service_contracts/abi'

            return {
              url: `${baseUrl}/${contract.name}.abi.json`,
            }
          },
        }),
      ],
    },
  ]
})

export default config
