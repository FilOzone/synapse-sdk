import { open } from 'node:fs/promises'
import path from 'node:path'
import * as p from '@clack/prompts'
import type { PieceCID } from '@filoz/synapse-core/piece'
import { createPieceUrlPDP } from '@filoz/synapse-core/utils'
import { type PieceRecord, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import type { Hex } from 'viem'
import { privateKeyClient } from '../client.ts'
import { globalFlags } from '../flags.ts'

export const upload: Command = command(
  {
    name: 'upload',
    parameters: ['<required path>'],
    description: 'Upload a file to the warm storage',
    alias: 'u',
    flags: {
      ...globalFlags,
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
    const { client } = privateKeyClient(argv.flags.chain)

    const filePath = argv._.requiredPath
    const absolutePath = path.resolve(filePath)
    const fileHandle = await open(absolutePath)

    try {
      const synapse = new Synapse({
        client,
      })

      p.log.step('Creating context...')
      const context = await synapse.storage.createContext({
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

      const data = fileHandle.readableWebStream()
      await context.upload(data, {
        pieceMetadata: {
          name: path.basename(absolutePath),
        },
        onStored(providerId: bigint, pieceCid: PieceCID) {
          const url = createPieceUrlPDP({
            cid: pieceCid.toString(),
            serviceURL: context.provider.pdp.serviceURL,
          })
          p.log.info(`Stored on provider ${providerId}! ${url}`)
        },
        onPiecesAdded(
          transaction: Hex,
          providerId: bigint,
          pieces: { pieceCid: PieceCID }[]
        ) {
          p.log.info(
            `Pieces added for provider ${providerId}, tx: ${transaction}`
          )
          for (const { pieceCid } of pieces) {
            p.log.info(`  ${pieceCid}`)
          }
        },
        onPiecesConfirmed(
          dataSetId: bigint,
          providerId: bigint,
          pieces: PieceRecord[]
        ) {
          p.log.info(
            `Data set ${dataSetId} confirmed on provider ${providerId}`
          )
          for (const { pieceCid, pieceId } of pieces) {
            p.log.info(`  ${pieceCid} → pieceId ${pieceId}`)
          }
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
