import * as p from '@clack/prompts'
import { RPC_URLS, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { readFile } from 'fs/promises'
import path from 'path'
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

    const spinner = p.spinner()

    const filePath = argv._.requiredPath
    const absolutePath = path.resolve(filePath)
    const fileData = await readFile(absolutePath)

    spinner.start(`Uploading file ${absolutePath}...`)
    try {
      const synapse = await Synapse.create({
        privateKey: privateKey as Hex,
        rpcURL: RPC_URLS.calibration.http, // Use calibration testnet for testing
      })

      const upload = await synapse.storage.upload(fileData, {
        forceCreateDataSet: argv.flags.forceCreateDataSet,
        withCDN: argv.flags.withCDN,
        dataSetId: argv.flags.dataSetId,
        metadata: {
          name: path.basename(absolutePath),
        },
        callbacks: {
          onDataSetCreationStarted(transaction) {
            spinner.message(`Creating data set, tx: ${transaction.hash}`)
          },
          onProviderSelected(provider) {
            spinner.message(`Selected provider: ${provider.serviceProvider}`)
          },
          onDataSetResolved(info) {
            spinner.message(`Using existing data set: ${info.dataSetId}`)
          },
          onUploadComplete(pieceCid) {
            spinner.message(`Upload complete! PieceCID: ${pieceCid}`)
          },
          onPieceAdded(transaction) {
            spinner.message(`Piece add, tx: ${transaction?.hash}`)
          },
          onPieceConfirmed(pieceIds) {
            spinner.message(`Piece confirmed: ${pieceIds.join(', ')}`)
          },
        },
      })

      spinner.stop(`File uploaded ${upload.pieceCid}`)
    } catch (error) {
      spinner.stop()
      p.log.error((error as Error).message)
      p.outro('Please try again')
      return
    }
  }
)
