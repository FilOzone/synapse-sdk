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
import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
import { type Command, command } from 'cleye'
import { type Address, getContract, isAddress, isHex } from 'viem'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

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
    const { client, chain } = privateKeyClient(argv.flags.chain)

    const endorsements = getContract({
      ...chain.contracts.endorsements,
      client,
    })

    while (true) {
      const [owner, endorsed] = await Promise.all([
        endorsements.read.owner(),
        endorsements.read.getProviderIds(),
      ])
      const serviceUrls = (
        await Promise.all(
          endorsed.map((providerId) => getPDPProvider(client, { providerId }))
        )
      ).reduce<Record<number, string>>((serviceUrls, providerWithProduct) => {
        serviceUrls[Number(providerWithProduct.id)] =
          providerWithProduct.pdp.serviceURL
        return serviceUrls
      }, {})
      const lines = [
        `Current User: ${client.account.address}`,
        `Owner: ${owner}`,
        `Endorsements: ${endorsed.length}`,
        ...endorsed.map(
          (providerId) => `- [${providerId}] ${serviceUrls[Number(providerId)]}`
        ),
      ]
      log.info(lines.join('\n'))

      const isOwner = client.account.address === owner
      const requiresOwner = isOwner ? undefined : 'not owner'

      const action = await select({
        message: 'Select an action',
        options: [
          { value: 'refresh' },
          { value: 'addProvider', hint: requiresOwner },
          { value: 'removeProvider', hint: requiresOwner },
          { value: 'transferOwnership', hint: requiresOwner },
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
                  hint: `${serviceUrls[Number(providerId)]}`,
                }
              }),
            ],
          })
          if (isCancel(providerId)) {
            cancel(`Canceled`)
          } else if (providerId !== 'go back') {
            const confirmed = await confirm({
              message: `Remove provider ${providerId} (${serviceUrls[Number(providerId)]})?`,
            })
            if (isCancel(confirmed)) {
              cancel(`Canceled`)
            } else if (confirmed) {
              const txSpin = spinner()
              txSpin.start(`Submitting transaction`)
              try {
                const txHash = await endorsements.write.removeProviderId([
                  BigInt(providerId),
                ])
                txSpin.stop(`Transaction submitted: ${txHash}`)
              } catch (error) {
                txSpin.stop(
                  `Failed to remove ${providerId}: ${(error as Error).message}`
                )
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
            const providerWithProduct = await getPDPProvider(client, {
              providerId: BigInt(providerId),
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
                const txHash = await endorsements.write.addProviderId([
                  BigInt(providerId),
                ])
                txSpin.stop(`Transaction submitted: ${txHash}`)
              } catch (error) {
                txSpin.stop(
                  `Failed to remove ${providerId}: ${(error as Error).message}`
                )
              }
            }
          }
          break
        }
        case 'transferOwnership': {
          const newOwner = await text({
            message: 'What is the address of the new owner?',
            placeholder: `^C to cancel`,
            validate(value) {
              if (!value) {
                return `Please try again`
              }
              if (value.length !== 42) {
                return `Unexpected address length ${value.length}, expecting 42`
              }
              if (!isHex('0x')) {
                return `Address should start with 0x`
              }
              if (!isAddress(value)) {
                return `Invalid address`
              }
            },
          })
          if (isCancel(newOwner)) {
            cancel(`Canceled`)
          } else {
            const confirmed = await confirm({
              message: `Transfer ownership to ${newOwner}?`,
            })
            if (isCancel(confirmed)) {
              cancel(`Canceled`)
            } else if (confirmed) {
              const txSpin = spinner()
              txSpin.start(`Submitting transaction`)
              try {
                const txHash = await endorsements.write.transferOwnership([
                  newOwner as Address,
                ])
                txSpin.stop(`Transaction submitted: ${txHash}`)
              } catch (error) {
                txSpin.stop(
                  `Failed to transfer ownership: ${(error as Error).message}`
                )
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
