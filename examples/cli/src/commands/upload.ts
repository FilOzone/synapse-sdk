import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as p from '@clack/prompts'
import { RPC_URLS, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import type { Hex } from 'viem'
import config from '../config.ts'

export const upload: Command = command(
  {
    name: 'upload',
    parameters: ['<required path>'],
    description: 'Upload a file to the warm storage',
    alias: 'u',
    flags: {
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
        type: Number,
        description: 'The data set ID to use',
        default: undefined,
      },
    },
    help: {
      description: 'Upload a file to the warm storage',
    },
  },
  async (argv) => {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      p.log.error('Private key not found')
      p.outro('Please run `synapse init` to initialize the CLI')
      return
    }

    const filePath = argv._.requiredPath
    const absolutePath = path.resolve(filePath)
    const fileData = await readFile(absolutePath)

    try {
      const synapse = await Synapse.create({
        privateKey: privateKey as Hex,
        rpcURL: RPC_URLS.calibration.http, // Use calibration testnet for testing
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

      const upload = await context.upload(fileData, {
        metadata: {
          name: path.basename(absolutePath),
        },
        onPiecesAdded(transactionHash, pieces) {
          p.log.info(`Pieces added in tx: ${transactionHash}`)
          if (pieces?.length) {
            p.log.info(
              `PieceCIDs: ${pieces.map(({ pieceCid }) => pieceCid.toString()).join(', ')}`
            )
          }
        },
        onPiecesConfirmed(dataSetId, pieces) {
          p.log.info(`Data set ${dataSetId} confirmed`)
          p.log.info(
            `Piece IDs: ${pieces.map(({ pieceId }) => pieceId).join(', ')}`
          )
        },
        onUploadComplete(pieceCid) {
          p.log.info(`Upload complete! PieceCID: ${pieceCid}`)
        },
      })

      p.log.success(`File uploaded ${upload.pieceId}`)
    } catch (error) {
      p.log.error((error as Error).message)
      p.outro('Please try again')
      return
    }
  }
)
