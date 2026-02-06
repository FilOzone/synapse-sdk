import path from 'node:path'
import * as p from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
import { openLazyFile } from '@remix-run/fs'
import { type Command, command } from 'cleye'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'
import { hashLink } from '../utils.ts'

export const piecesUpload: Command = command(
  {
    name: 'pieces-upload',
    parameters: ['<path>', '<dataSetId>'],
    description: 'Upload a file to a data set',
    flags: {
      ...globalFlags,
      cdn: {
        type: Boolean,
        description: 'Enable CDN',
        default: false,
      },
    },
    help: {
      description: 'Upload a file to a data set',
    },
  },
  async (argv) => {
    const { client, chain } = privateKeyClient(argv.flags.chain)
    // const spinner = p.spinner()

    const filePath = argv._.path
    const absolutePath = path.resolve(filePath)
    const file = openLazyFile(absolutePath)

    p.log.info(`Uploading file ${absolutePath}...`)
    try {
      const result = await SP.upload(client, {
        dataSetId: BigInt(argv._.dataSetId),
        data: [file],
        onEvent: (event, data) => {
          p.log.info(`${event} ${data.pieceCid.toString()}`)
        },
      })

      p.log.info(
        `Waiting for tx ${hashLink(result.txHash, chain)} to be mined...`
      )
      const pieces = await SP.waitForAddPieces(result)
      p.log.info(`File uploaded ${pieces.confirmedPieceIds.join(',')}`)
    } catch (error) {
      p.log.error((error as Error).message)
      p.outro('Please try again')
      return
    }
  }
)
