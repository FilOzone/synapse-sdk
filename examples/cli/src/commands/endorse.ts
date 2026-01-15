import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts'
import { getChain } from '@filoz/synapse-core/chains'
import { getProvider } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import type { Address, Hash } from 'viem'
import { readContract, simulateContract, writeContract } from 'viem/actions'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

class EndorsementsContract {
  constructor(client) {
    this.client = client

    const chain = getChain(client.chain.id)
    this.contract = chain.contracts.endorsements
  }

  async getProviderIds(): number[] {
    const providerIds = await readContract(this.client, {
      ...this.contract,
      functionName: 'getProviderIds',
    })
    return providerIds.map(Number)
  }

  async removeProviderId(providerId: number): Hash {
    const { request } = await simulateContract(this.client, {
      ...this.contract,
      account: this.client.account,
      functionName: 'removeProviderId',
      args: [providerId],
    })
    return await writeContract(this.client, request)
  }

  async addProviderId(providerId: number): Hash {
    const { request } = await simulateContract(this.client, {
      ...this.contract,
      account: this.client.account,
      functionName: 'addProviderId',
      args: [providerId],
    })
    return await writeContract(this.client, request)
  }

  async owner(): Address {
    return await readContract(this.client, {
      ...this.contract,
      functionName: 'owner',
    })
  }
}

export const endorse: Command = command(
  {
    name: 'endorse',
    description: 'Endorse Service Provider',
    alias: 'e',
    flags: {
      ...globalFlags,
    },
  },
  async (argv) => {
    intro('Endorsements')
    log.info('Loading account')
    const { client } = privateKeyClient(argv.flags.chain)

    const endorsements = new EndorsementsContract(client)

    while (true) {
      const [owner, endorsed] = await Promise.all([
        endorsements.owner(),
        endorsements.getProviderIds(),
      ])
      const serviceUrls = (
        await Promise.all(
          endorsed.map((providerId) => getProvider(client, { providerId }))
        )
      ).reduce((serviceUrls, providerWithProduct) => {
        serviceUrls[providerWithProduct.id] = providerWithProduct.pdp.serviceURL
        return serviceUrls
      }, {})
      const lines = [
        `Current User: ${client.account.address}`,
        `Owner: ${owner}`,
        `Endorsements: ${endorsed.length}`,
        ...endorsed.map(
          (providerId) => `- [${providerId}] ${serviceUrls[providerId]}`
        ),
      ]
      log.info(lines.join('\n'))

      const isOwner = client.account.address === owner

      const action = await select({
        message: 'Select an action',
        options: [
          { value: 'refresh' },
          { value: 'addProvider', disabled: !isOwner },
          { value: 'removeProvider', disabled: !isOwner },
          { value: 'transferOwnership', disabled: !isOwner },
          { value: 'exit' },
        ],
      })
      if (isCancel(action)) {
        cancel('Got interrupt, exiting')
        process.exit(0)
      }
      switch (action) {
        case 'refresh': {
          continue
        }
        case 'exit': {
          outro('bye!')
          process.exit(0)
          break
        }
        case 'removeProvider': {
          const providerId = await select({
            message: 'Remove which provider?',
            options: [
              { value: 'go back' },
              ...endorsed.map((providerId) => {
                return {
                  value: `${providerId}`,
                  hint: `${serviceUrls[providerId]}`,
                }
              }),
            ],
          })
          if (isCancel(providerId)) {
            cancel(`Canceled`)
          } else if (providerId !== 'go back') {
            const confirmed = await confirm({
              message: `Remove provider ${providerId} (${serviceUrls[providerId]})?`,
            })
            if (isCancel(confirmed)) {
              cancel(`Canceled`)
            } else if (confirmed) {
              const txSpin = spinner()
              txSpin.start(`Submitting transaction`)
              try {
                const txHash = await endorsements.removeProviderId(
                  Number(providerId)
                )
                txSpin.stop(`Transaction submitted: ${txHash}`)
              } catch (error) {
                txSpin.stop(`Failed to remove ${providerId}: ${error.message}`)
              }
            }
          }
          break
        }
        case 'addProvider': {
          const providerId = await text({
            message: 'Add which provider?',
            placeholder: `^C to cancel`,
            validate(value) {
              const number = Number(value)
              if (!Number.isInteger(number) || number <= 0) {
                return 'providerId should be a positive integer'
              }
            },
          })
          if (isCancel(providerId)) {
            cancel(`Canceled`)
          } else {
            const providerWithProduct = await getProvider(client, {
              providerId,
            })
            const confirmed = await confirm({
              message: `Add provider ${providerId} (${providerWithProduct.pdp.serviceURL})?`,
            })
            if (isCancel(confirmed)) {
              cancel(`Canceled`)
            } else if (confirmed) {
              const txSpin = spinner()
              txSpin.start(`Submitting transaction`)
              try {
                const txHash = await endorsements.addProviderId(
                  Number(providerId)
                )
                txSpin.stop(`Transaction submitted: ${txHash}`)
              } catch (error) {
                txSpin.stop(`Failed to remove ${providerId}: ${error.message}`)
              }
            }
          }
          break
        }
        default: {
          log.error('Unsupported option')
        }
      }
    }
  }
)
