import path from 'node:path'
import * as p from '@clack/prompts'
import * as SP from '@filoz/synapse-core/sp'
import { upload } from '@filoz/synapse-core/warm-storage'
import { openFile } from '@remix-run/fs'
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
    const spinner = p.spinner()

    const filePath = argv._.path
    const absolutePath = path.resolve(filePath)
    const file = openFile(absolutePath)

    spinner.start(`Uploading file ${absolutePath}...`)
    try {
      const result = await upload(client, {
        dataSetId: BigInt(argv._.dataSetId),
        data: [file],
        onEvent: (event, data) => {
          spinner.message(`${event} ${data.pieceCid.toString()}`)
        },
      })

      spinner.message(
        `Waiting for tx ${hashLink(result.txHash, chain)} to be mined...`
      )
      const pieces = await SP.waitForAddPiecesStatus(result)
      spinner.stop(`File uploaded ${pieces.confirmedPieceIds.join(',')}`)
    } catch (error) {
      spinner.stop()
      p.log.error((error as Error).message)
      p.outro('Please try again')
      return
    }
  }
)
