import * as p from '@clack/prompts'
import { schedulePieceDeletion } from '@filoz/synapse-core/sp'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { waitForTransactionReceipt } from 'viem/actions'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink, selectDataSet, selectPiece } from '../utils.ts'

export const piecesRemoval: Command = command(
  {
    name: 'pieces-removal',
    description: 'Remove a piece from a data set',
    alias: 'pr',
    parameters: ['[dataSetId]', '[pieceId]'],
    flags: {
      ...globalFlags,
    },
    help: {
      description: 'Remove a piece from a data set',
      examples: ['synapse pieces-removal 1 2', 'synapse pieces-removal --help'],
    },
  },
  async (argv) => {
    const { client, chain } = privateKeyClient(argv.flags.chain)

    try {
      const dataSetId = argv._.dataSetId
        ? BigInt(argv._.dataSetId)
        : await selectDataSet(client, argv.flags)

      const dataSet = await getPdpDataSet(client, {
        dataSetId,
      })
      if (!dataSet) {
        p.cancel(`Data set ${dataSetId} not found.`)
        process.exit(1)
      }

      const pieceId = argv._.pieceId
        ? BigInt(argv._.pieceId)
        : await selectPiece(client, dataSet, argv.flags)

      p.log.info(`Removing piece ${pieceId} from data set ${dataSetId}...`)
      const result = await schedulePieceDeletion(client, {
        dataSetId,
        clientDataSetId: dataSet.clientDataSetId,
        pieceId,
        serviceURL: dataSet.provider.pdp.serviceURL,
      })

      p.log.info(
        `Waiting for tx ${hashLink(result.hash, chain)} to be mined...`
      )
      await waitForTransactionReceipt(client, result)

      p.log.info(`Piece removed`)
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)
