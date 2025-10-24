import { defineConfig } from '@wagmi/cli'
import { fetch } from '@wagmi/cli/plugins'
import type { Address } from 'viem'

// const REF = 'refs/tags/v0.3.0'
// const REF = '15eeb6dc87db236507add5553a0c76c009705525'
const REF = 'refs/heads/kubuxu/devnode-contracts'
const URL = `https://raw.githubusercontent.com/FilOzone/filecoin-services/${REF}/service_contracts/abi`

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
        314159: '0xD3De778C05f89e1240ef70100Fb0d9e5b2eFD258' as Address,
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
        314159: '0x0295Ac959317391656fB7fFaA046046eF9C7E18F' as Address,
      },
    },
    {
      name: 'PDPVerifier',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x06279D540BDCd6CA33B073cEAeA1425B6C68c93d' as Address,
      },
    },
    {
      name: 'ServiceProviderRegistry',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0xc758dB755f59189d8FB3C166Ee372b77d7CFA9D3' as Address,
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
              url: `${URL}/${contract.name}.abi.json`,
            }
          },
        }),
      ],
    },
  ]
})

export default config
