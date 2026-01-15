import {
  confirm,
  intro,
  log,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts'
import { getChain } from '@filoz/synapse-core/chains'
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
      const lines = [
        `Current User: ${client.account.address}`,
        `Owner: ${owner}`,
        `Endorsements: ${endorsed.length}`,
        ...endorsed.map((providerId) => `- ${providerId}`),
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
            message: '',
            options: [
              { value: 'go back' },
              ...endorsed.map((providerId) => {
                return {
                  value: String(providerId),
                }
              }),
            ],
          })
          if (providerId !== 'go back') {
            if (await confirm({ message: `Remove provider ${providerId}?` })) {
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
            message: '',
            validate(value) {
              const number = Number(value)
              if (!Number.isInteger(number) || number <= 0) {
                return 'providerId should be a positive integer'
              }
            },
          })
          if (await confirm({ message: `Add provider ${providerId}?` })) {
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
          break
        }
        default: {
          log.error('Unsupported option')
        }
      }
    }
  }
)
