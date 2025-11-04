import * as p from '@clack/prompts'
import { calibration } from '@filoz/synapse-core/chains'
import { metadataArrayToObject } from '@filoz/synapse-core/utils'
import { getDataSets, getPieces, type Piece } from '@filoz/synapse-core/warm-storage'
import { RPC_URLS, Synapse } from '@filoz/synapse-sdk'
import { type Command, command } from 'cleye'
import { createPublicClient, type Hex, http, stringify } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readContract, waitForTransactionReceipt } from 'viem/actions'
import config from '../config.ts'

const publicClient = createPublicClient({
  chain: calibration,
  transport: http(),
})

export const pieces: Command = command(
  {
    name: 'pieces',
    description: 'List all pieces',
    alias: 'ps',
    help: {
      description: 'List all pieces',
      examples: ['synapse pieces', 'synapse pieces --help'],
    },
  },
  async (_argv) => {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      p.log.error('Private key not found')
      p.outro('Please run `synapse init` to initialize the CLI')
      return
    }

    const account = privateKeyToAccount(privateKey as Hex)
    const spinner = p.spinner()

    spinner.start('Fetching data sets...')
    try {
      const dataSets = await getDataSets(publicClient, {
        address: account.address,
      })
      spinner.stop('Fetching data sets complete')
      let pieces: Piece[] = []
      const group = await p.group(
        {
          dataSetId: () => {
            return p.select({
              message: 'Pick a data set.',
              options: dataSets
                .filter((dataSet) => dataSet.pdpEndEpoch === 0n)
                .map((dataSet) => ({
                  value: dataSet.dataSetId,
                  label: `#${dataSet.dataSetId} - SP: #${dataSet.providerId} ${dataSet.pdp.serviceURL}`,
                })),
            })
          },
          pieceId: async ({ results }) => {
            const dataSetId = results.dataSetId
            const rsp = await getPieces(publicClient, {
              // biome-ignore lint/style/noNonNullAssertion: dataSetId is guaranteed to be found
              dataSet: dataSets.find((dataSet) => dataSet.dataSetId === dataSetId)!,
              address: account.address,
            })
            pieces = rsp.pieces
            if (rsp.pieces.length === 0) {
              p.outro('No pieces found')
              return
            }
            return await p.select({
              message: 'Pick a piece.',
              options: rsp.pieces.map((piece) => ({
                value: piece.id,
                label: `#${piece.id} ${piece.cid}`,
              })),
            })
          },
          action: async () => {
            if (pieces.length === 0) {
              return
            }
            return p.select({
              message: 'Pick an action.',
              options: [
                { value: 'info', label: 'Info' },
                { value: 'delete', label: 'Delete' },
              ],
            })
          },
        },
        {
          // On Cancel callback that wraps the group
          // So if the user cancels one of the prompts in the group this function will be called
          onCancel: () => {
            p.cancel('Operation cancelled.')
            process.exit(0)
          },
        }
      )

      if (group.action === 'info') {
        // biome-ignore lint/style/noNonNullAssertion: pieceId is guaranteed to be found
        const piece = pieces.find((piece) => piece.id === group.pieceId)!
        const metadata = await readContract(publicClient, {
          address: calibration.contracts.storageView.address,
          abi: calibration.contracts.storageView.abi,
          functionName: 'getAllPieceMetadata',
          args: [group.dataSetId, BigInt(piece.id)],
        })
        p.log.message(
          stringify(
            {
              ...piece,
              metadata: metadataArrayToObject(metadata),
            },
            undefined,
            2
          )
        )
      } else if (group.action === 'delete') {
        spinner.start('Deleting piece...')
        // biome-ignore lint/style/noNonNullAssertion: pieceId is guaranteed to be found
        const piece = pieces.find((piece) => piece.id === group.pieceId)!
        const synapse = await Synapse.create({
          privateKey: privateKey as Hex,
          rpcURL: RPC_URLS.calibration.http,
        })
        const context = await synapse.storage.createContext({
          dataSetId: Number(group.dataSetId),
        })
        const txHash = await context.deletePiece(piece.cid)
        spinner.message('Waiting for transaction to be mined...')
        await waitForTransactionReceipt(publicClient, { hash: txHash as Hex })
        spinner.stop('Piece deleted')
      } else {
        return
      }
    } catch (error) {
      spinner.stop()
      console.error(error)
      return
    }
  }
)
