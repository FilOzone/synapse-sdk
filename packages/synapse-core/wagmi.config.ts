import { defineConfig } from '@wagmi/cli'
import { fetch } from '@wagmi/cli/plugins'
import type { Address } from 'viem'

const config: ReturnType<typeof defineConfig> = defineConfig(() => {
  const contracts = [
    {
      name: 'Payments',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x1096025c9D6B29E12E2f04965F6E64d564Ce0750' as Address,
      },
    },
    {
      name: 'FilecoinWarmStorageService',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x80617b65FD2EEa1D7fDe2B4F85977670690ed348' as Address,
      },
    },
    {
      name: 'FilecoinWarmStorageServiceStateView',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x87EDE87cEF4BfeFE0374c3470cB3F5be18b739d5' as Address,
      },
    },
    {
      name: 'PDPVerifier',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x445238Eca6c6aB8Dff1Aa6087d9c05734D22f137' as Address,
      },
    },
    {
      name: 'ServiceProviderRegistry',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0xA8a7e2130C27e4f39D1aEBb3D538D5937bCf8ddb' as Address,
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
            const baseUrl =
              'https://raw.githubusercontent.com/FilOzone/filecoin-services/refs/tags/alpha/calibnet/0x80617b65FD2EEa1D7fDe2B4F85977670690ed348-v2/service_contracts/abi'

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
