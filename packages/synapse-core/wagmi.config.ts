import { defineConfig } from '@wagmi/cli'
import { fetch as fetchPlugin } from '@wagmi/cli/plugins'
import { request } from 'iso-web/http'
import { zeroAddress } from 'viem'
import * as z from 'zod'
import { ZodValidationError } from './src/errors/base.ts'
import { zAddress, zAddressLoose } from './src/utils/schemas.ts'

// GIT_REF can be one of: '<branch name>', '<commit>' or 'tags/<tag>'
const FILECOIN_SERVICES_GIT_REF = 'd08214e1b3d200e0bc80f0d4f2e5ea3e1e4d603e' // v1.2.0
const FILECOIN_SERVICES_REF = FILECOIN_SERVICES_GIT_REF.replace(/^(?![a-f0-9]{40}$)/, 'refs/')
const BASE_URL = `https://raw.githubusercontent.com/FilOzone/filecoin-services/${FILECOIN_SERVICES_REF}/service_contracts/abi`
const DEPLOYMENTS_URL = `https://raw.githubusercontent.com/FilOzone/filecoin-services/${FILECOIN_SERVICES_REF}/service_contracts/deployments.json`

const DeploymentSchema = z
  .object({
    metadata: z.object({
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      deployed_at: z.iso.datetime(),
    }),
    FILECOIN_PAY_ADDRESS: zAddress,
    PDP_VERIFIER_PROXY_ADDRESS: zAddress,
    PDP_VERIFIER_IMPLEMENTATION_ADDRESS: zAddressLoose,
    SESSION_KEY_REGISTRY_ADDRESS: zAddress,
    SERVICE_PROVIDER_REGISTRY_PROXY_ADDRESS: zAddress,
    SERVICE_PROVIDER_REGISTRY_IMPLEMENTATION_ADDRESS: zAddress,
    SIGNATURE_VERIFICATION_LIB_ADDRESS: zAddress,
    FWSS_PROXY_ADDRESS: zAddress,
    FWSS_IMPLEMENTATION_ADDRESS: zAddress,
    FWSS_VIEW_ADDRESS: zAddress,
    ENDORSEMENT_SET_ADDRESS: zAddress,
  })
  .strict()

const DeploymentsSchema = z.object({
  '314': DeploymentSchema,
  '314159': DeploymentSchema,
})

async function readDeployments() {
  const result = await request.get(DEPLOYMENTS_URL, {
    retry: {
      retries: 5,
    },
  })

  if (result.error) {
    throw result.error
  }

  const parsed = DeploymentsSchema.safeParse(await result.result.json())

  if (parsed.error) {
    throw new ZodValidationError(parsed.error)
  }

  return parsed.data
}

const config: ReturnType<typeof defineConfig> = defineConfig(async () => {
  const deployments = await readDeployments()
  const mainnetAddresses = deployments['314']
  const calibrationAddresses = deployments['314159']
  const contracts = [
    {
      name: 'Errors',
      address: {
        314: zeroAddress,
        314159: zeroAddress,
      },
    },
    {
      name: 'FilecoinPayV1',
      address: {
        314: mainnetAddresses.FILECOIN_PAY_ADDRESS,
        314159: calibrationAddresses.FILECOIN_PAY_ADDRESS,
      },
    },
    {
      name: 'FilecoinWarmStorageService',
      address: {
        314: mainnetAddresses.FWSS_PROXY_ADDRESS,
        314159: calibrationAddresses.FWSS_PROXY_ADDRESS,
      },
    },
    {
      name: 'FilecoinWarmStorageServiceStateView',
      address: {
        314: mainnetAddresses.FWSS_VIEW_ADDRESS,
        314159: calibrationAddresses.FWSS_VIEW_ADDRESS,
      },
    },
    {
      name: 'PDPVerifier',
      address: {
        314: mainnetAddresses.PDP_VERIFIER_PROXY_ADDRESS,
        314159: calibrationAddresses.PDP_VERIFIER_PROXY_ADDRESS,
      },
    },
    {
      name: 'ServiceProviderRegistry',
      address: {
        314: mainnetAddresses.SERVICE_PROVIDER_REGISTRY_PROXY_ADDRESS,
        314159: calibrationAddresses.SERVICE_PROVIDER_REGISTRY_PROXY_ADDRESS,
      },
    },
    {
      name: 'SessionKeyRegistry',
      address: {
        314: mainnetAddresses.SESSION_KEY_REGISTRY_ADDRESS,
        314159: calibrationAddresses.SESSION_KEY_REGISTRY_ADDRESS,
      },
    },
    {
      name: 'ProviderIdSet',
      address: {
        314: mainnetAddresses.ENDORSEMENT_SET_ADDRESS,
        314159: calibrationAddresses.ENDORSEMENT_SET_ADDRESS,
      },
    },
  ]

  return [
    {
      out: 'src/abis/generated.ts',
      plugins: [
        fetchPlugin({
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
