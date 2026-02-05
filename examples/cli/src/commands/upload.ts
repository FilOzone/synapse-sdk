import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as p from '@clack/prompts'
import { createPieceUrlPDP } from '@filoz/synapse-core/utils'
import { Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink } from '../utils.ts'

export const upload: Command = command(
  {
    name: 'upload',
    parameters: ['<required path>'],
    description: 'Upload a file to the warm storage',
    alias: 'u',
    flags: {
      ...globalFlags,
      forceCreateDataSet: {
        type: Boolean,
        description: 'Force create a new data set',
        default: false,
      },
      withCDN: {
        type: Boolean,
        description: 'Enable CDN',
        default: false,
      },
      dataSetId: {
        type: BigInt,
        description: 'The data set ID to use',
        default: undefined,
      },
    },
    help: {
      description: 'Upload a file to the warm storage',
    },
  },
  async (argv) => {
    const { client, chain } = privateKeyClient(argv.flags.chain)

    const filePath = argv._.requiredPath
    const absolutePath = path.resolve(filePath)
    const fileData = await readFile(absolutePath)

    try {
      const synapse = new Synapse({
        client,
      })

      p.log.step('Creating context...')
      const context = await synapse.storage.createContext({
        forceCreateDataSet: argv.flags.forceCreateDataSet,
        withCDN: argv.flags.withCDN,
        dataSetId: argv.flags.dataSetId,
        callbacks: {
          onProviderSelected(provider) {
            p.log.info(`Selected provider: ${provider.serviceProvider}`)
          },
          onDataSetResolved(info) {
            p.log.info(`Using existing data set: ${info.dataSetId}`)
          },
        },
      })

      await context.upload(fileData, {
        metadata: {
          name: path.basename(absolutePath),
        },
        onUploadComplete(pieceCid) {
          const url = createPieceUrlPDP(
            pieceCid.toString(),
            context.provider.pdp.serviceURL
          )
          p.log.info(`Upload complete! ${url}`)
        },
        onPiecesAdded(transactionHash) {
          p.log.info(`Pieces added in tx ${hashLink(transactionHash, chain)}`)
        },
        onPiecesConfirmed(dataSetId, pieces) {
          p.log.info(`Data set ${dataSetId} confirmed`)
          p.log.info(
            `Piece IDs: ${pieces.map(({ pieceId }) => pieceId).join(', ')}`
          )
        },
      })

      p.log.success(`File uploaded`)
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)
