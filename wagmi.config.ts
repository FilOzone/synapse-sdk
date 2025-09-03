import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@wagmi/cli'
import { fetch } from '@wagmi/cli/plugins'
import { readFile } from 'fs/promises'
import type { Address } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
      name: 'WarmStorage',
      address: {
        314: '0x0000000000000000000000000000000000000000' as Address,
        314159: '0x0000000000000000000000000000000000000000' as Address,
      },
    },
    {
      name: 'WarmStorageView',
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
          async parse({ response }) {
            const data = await response.json()

            let _abi: string

            // DUMB hack until we have github abi urls for all the contracts
            if (data.message) {
              switch (data.message) {
                case 'Payments':
                  _abi = await readFile(join(__dirname, 'src/abis', `payments.json`), 'utf-8')
                  break
                case 'PDPVerifier':
                  _abi = await readFile(join(__dirname, 'src/abis', `pdp.json`), 'utf-8')
                  break
                default:
                  throw new Error(`Unknown contract: ${data.message}`)
              }
              return JSON.parse(_abi)
            } else {
              return data
            }
          },
          request(contract) {
            switch (contract.name) {
              case 'ServiceProviderRegistry':
                return {
                  url: `https://raw.githubusercontent.com/FilOzone/filecoin-services/refs/heads/main/service_contracts/abi/ServiceProviderRegistry.abi.json`,
                }
              case 'WarmStorage':
                return {
                  url: `https://raw.githubusercontent.com/FilOzone/filecoin-services/refs/heads/main/service_contracts/abi/FilecoinWarmStorageService.abi.json`,
                }
              case 'WarmStorageView':
                return {
                  url: `https://raw.githubusercontent.com/FilOzone/filecoin-services/refs/heads/main/service_contracts/abi/FilecoinWarmStorageServiceStateView.abi.json`,
                }
              case 'SessionKeyRegistry':
                return {
                  url: `https://raw.githubusercontent.com/FilOzone/filecoin-services/refs/heads/main/service_contracts/abi/SessionKeyRegistry.abi.json`,
                }
              default:
                return {
                  url: `https://dummyjson.com/http/200/${contract.name}`,
                }
            }
          },
        }),
      ],
    },
  ]
})

export default config
