import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as p from '@clack/prompts'
import * as Piece from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
import { type Command, command } from 'cleye'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink, selectProvider } from '../utils.ts'

export const uploadDataset: Command = command(
  {
    name: 'upload-dataset',
    parameters: ['<path>', '[providerId]'],
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
    const { client, chain } = privateKeyClient(argv.flags.chain)

    const filePath = argv._.path
    const provider = argv._.providerId
      ? await getPDPProvider(client, { providerId: BigInt(argv._.providerId) })
      : await selectProvider(client, argv.flags)

    if (!provider) {
      p.log.error('Provider not found')
      p.outro('Please try again')
      return
    }
    p.log.info(`Selected provider: #${provider.id}`)
    const absolutePath = path.resolve(filePath)
    const fileData = await readFile(absolutePath)

    p.log.info(`Uploading file ${absolutePath}...`)
    try {
      const pieceCid = Piece.calculate(fileData)
      await SP.uploadPiece({
        data: fileData,
        serviceURL: provider.pdp.serviceURL,
        pieceCid,
      })

      await SP.findPiece({
        pieceCid,
        serviceURL: provider.pdp.serviceURL,
        retry: true,
      })

      const rsp = await SP.createDataSetAndAddPieces(client, {
        serviceURL: provider.pdp.serviceURL,
        payee: provider.payee,
        cdn: argv.flags.cdn,
        pieces: [
          {
            pieceCid,
            metadata: { name: path.basename(absolutePath) },
          },
        ],
      })
      p.log.info(`Waiting for tx ${hashLink(rsp.txHash, chain)} to be mined...`)

      const createdDataset = await SP.waitForCreateDataSetAddPieces({
        statusUrl: rsp.statusUrl,
      })

      p.log.success(
        `File uploaded ${pieceCid} dataset #${createdDataset.dataSetId} pieces #${createdDataset.piecesIds.join(', ')}`
      )
    } catch (error) {
      if (argv.flags.debug) {
        console.error(error)
      } else {
        p.log.error((error as Error).message)
      }
    }
  }
)
