import * as p from '@clack/prompts'
import type { Chain } from '@filoz/synapse-core/chains'
import { getPieces } from '@filoz/synapse-core/pdp-verifier'
import {
  getApprovedPDPProviders,
  getPDPProviders,
} from '@filoz/synapse-core/sp-registry'
import {
  getPdpDataSets,
  type PdpDataSet,
} from '@filoz/synapse-core/warm-storage'
import terminalLink from 'terminal-link'
import type { Account, Client, Transport } from 'viem'

export function hashLink(hash: string, chain: Chain) {
  const link = terminalLink(
    hash,
    `${chain.blockExplorers?.default?.url}/tx/${hash}`
  )
  return link
}

export async function selectDataSet(
  client: Client<Transport, Chain, Account>,
  options: { debug?: boolean }
) {
  const spinner = p.spinner()
  spinner.start(`Fetching data sets...`)

  try {
    const dataSets = await getPdpDataSets(client, {
      address: client.account.address,
    })
    spinner.stop(`Data sets fetched.`)

    if (dataSets.length === 0) {
      p.cancel('No data sets found.')
      process.exit(1)
    }

    const dataSetId = await p.select({
      message: 'Select a data set:',
      options: dataSets.map((dataSet) => ({
        value: dataSet.dataSetId,
        label: `#${dataSet.dataSetId} - SP: #${dataSet.providerId} ${dataSet.provider.pdp.serviceURL} ${dataSet.pdpEndEpoch > 0n ? `Terminating at epoch ${dataSet.pdpEndEpoch}` : ''}`,
      })),
    })
    if (p.isCancel(dataSetId)) {
      p.cancel('Operation cancelled.')
      process.exit(1)
    }

    return dataSetId
  } catch (error) {
    spinner.error('Failed to select data set')
    if (options.debug) {
      console.error(error)
    } else {
      p.log.error((error as Error).message)
    }
    process.exit(1)
  }
}

export async function selectPiece(
  client: Client<Transport, Chain, Account>,
  dataSet: PdpDataSet,
  options: { debug?: boolean }
) {
  const spinner = p.spinner()
  spinner.start(`Fetching pieces...`)

  try {
    const pieces = await getPieces(client, {
      dataSet,
      address: client.account.address,
    })
    spinner.stop(`Pieces fetched.`)

    if (pieces.pieces.length === 0) {
      p.cancel('No pieces found.')
      process.exit(1)
    }

    const pieceId = await p.select({
      message: 'Select a piece:',
      options: pieces.pieces.map((piece) => ({
        value: piece.id,
        label: `#${piece.id} ${piece.cid}`,
      })),
    })
    if (p.isCancel(pieceId)) {
      p.cancel('Operation cancelled.')
      process.exit(1)
    }

    return pieceId
  } catch (error) {
    spinner.error('Failed to select piece')
    if (options.debug) {
      console.error(error)
    } else {
      p.log.error((error as Error).message)
    }
    process.exit(1)
  }
}

export async function selectProvider(
  client: Client<Transport, Chain, Account>,
  options: { debug?: boolean }
) {
  const spinner = p.spinner()
  spinner.start(`Fetching providers...`)

  try {
    const providers = await getApprovedPDPProviders(client)
    spinner.stop(`Providers fetched.`)

    if (providers.length === 0) {
      p.cancel('No providers found.')
      process.exit(1)
    }

    const providerId = await p.select({
      message: 'Select a provider:',

      options: providers.map((provider) => ({
        value: provider.id,
        label: `#${provider.id} - ${provider.serviceProvider} ${provider.pdp.serviceURL}`,
      })),
    })
    if (p.isCancel(providerId)) {
      p.cancel('Operation cancelled.')
      process.exit(1)
    }

    return providers.find((provider) => provider.id === providerId)
  } catch (error) {
    spinner.error('Failed to select provider')
    if (options.debug) {
      console.error(error)
    } else {
      p.log.error((error as Error).message)
    }
    process.exit(1)
  }
}
