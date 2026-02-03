import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as p from '@clack/prompts'
import * as Piece from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { getPDPProviders } from '@filoz/synapse-core/sp-registry'
import { createDataSetAndAddPieces } from '@filoz/synapse-core/warm-storage'
import { type Command, command } from 'cleye'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const uploadDataset: Command = command(
  {
    name: 'upload-dataset',
    parameters: ['<required path>', '<required providerId>'],
    description: 'Upload a file to a new data set',
    flags: {
      ...globalFlags,
      cdn: {
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
    const { client } = privateKeyClient(argv.flags.chain)
    const spinner = p.spinner()

    const filePath = argv._.requiredPath
    const absolutePath = path.resolve(filePath)
    const fileData = await readFile(absolutePath)

    spinner.start(`Uploading file ${absolutePath}...`)
    try {
      const result = await getPDPProviders(client)
      const provider = result.providers.find(
        (provider) => provider.id === BigInt(argv._.requiredProviderId)
      )
      if (!provider) {
        p.log.error('Provider not found')
        p.outro('Please try again')
        return
      }

      const pieceCid = Piece.calculate(fileData)
      await SP.uploadPiece({
        data: fileData,
        endpoint: provider.pdp.serviceURL,
        pieceCid,
      })

      await SP.findPiece({
        pieceCid,
        endpoint: provider.pdp.serviceURL,
      })

      const rsp = await createDataSetAndAddPieces(client, {
        endpoint: provider.pdp.serviceURL,
        payee: provider.payee,
        cdn: argv.flags.cdn,
        pieces: [
          {
            pieceCid,
            metadata: { name: path.basename(absolutePath) },
          },
        ],
      })

      await SP.waitForDataSetCreationStatus(rsp)
      spinner.stop(`File uploaded ${pieceCid}`)
    } catch (error) {
      spinner.stop()
      p.log.error((error as Error).message)
      p.outro('Please try again')
      return
    }
  }
)
