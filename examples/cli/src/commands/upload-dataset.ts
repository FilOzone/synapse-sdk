import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as p from '@clack/prompts'
import { calibration } from '@filoz/synapse-core/chains'
import * as SP from '@filoz/synapse-core/sp'
import {
  createDataSetAndAddPieces,
  readProviders,
} from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from '../config.ts'

const publicClient = createPublicClient({
  chain: calibration,
  transport: http(),
})

export const uploadDataset: Command = command(
  {
    name: 'upload-dataset',
    parameters: ['<required path>', '<required providerId>'],
    description: 'Upload a file to a new data set',
    flags: {
      withCDN: {
        type: Boolean,
        description: 'Enable CDN',
        default: false,
      },
    },
    help: {
      description: 'Upload a file to a new data set',
    },
  },
  async (argv) => {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      p.log.error('Private key not found')
      p.outro('Please run `synapse init` to initialize the CLI')
      return
    }
    const account = privateKeyToAccount(privateKey as Hex)
    const client = createWalletClient({
      account,
      chain: calibration,
      transport: http(),
    })

    const spinner = p.spinner()

    const filePath = argv._.requiredPath
    const absolutePath = path.resolve(filePath)
    const fileData = await readFile(absolutePath)

    spinner.start(`Uploading file ${absolutePath}...`)
    try {
      const providers = await readProviders(publicClient)
      const provider = providers.find(
        (provider) => provider.id === BigInt(argv._.requiredProviderId)
      )
      if (!provider) {
        p.log.error('Provider not found')
        p.outro('Please try again')
        return
      }
      const upload = await SP.uploadPiece({
        data: fileData,
        endpoint: provider.pdp.serviceURL,
      })

      await SP.findPiece({
        pieceCid: upload.pieceCid,
        endpoint: provider.pdp.serviceURL,
      })

      const rsp = await createDataSetAndAddPieces(client, {
        provider,
        cdn: argv.flags.withCDN,
        pieces: [
          {
            pieceCid: upload.pieceCid,
            metadata: { name: path.basename(absolutePath) },
          },
        ],
      })

      await SP.pollForDataSetCreationStatus(rsp)
      spinner.stop(`File uploaded ${upload.pieceCid}`)
    } catch (error) {
      spinner.stop()
      p.log.error((error as Error).message)
      p.outro('Please try again')
      return
    }
  }
)
