import type { Account, Chain, Client, Transport } from 'viem'
import { readContract } from 'viem/actions'
import { getChain } from '../chains.ts'
import * as PDP from '../curio.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { pieceMetadataObjectToEntry } from '../utils/metadata.ts'

export type UploadOptions = {
  dataSetId: bigint
  data: File[]
}

export async function upload(client: Client<Transport, Chain, Account>, options: UploadOptions) {
  const chain = getChain(client.chain.id)

  const dataSet = await readContract(client, {
    address: chain.contracts.storageView.address,
    abi: chain.contracts.storageView.abi,
    functionName: 'getDataSet',
    args: [options.dataSetId],
  })

  const provider = await readContract(client, {
    address: chain.contracts.serviceProviderRegistry.address,
    abi: chain.contracts.serviceProviderRegistry.abi,
    functionName: 'getPDPService',
    args: [dataSet.providerId],
  })

  const uploadResponses = await Promise.all(
    options.data.map(async (data) => {
      const upload = await PDP.uploadPiece({
        data: new Uint8Array(await data.arrayBuffer()),
        endpoint: provider[0].serviceURL,
      })

      await PDP.findPiece({
        pieceCid: upload.pieceCid,
        endpoint: provider[0].serviceURL,
      })

      return {
        pieceCid: upload.pieceCid,
        metadata: { name: data.name, type: data.type },
      }
    })
  )

  const nextPieceId = await readContract(client, {
    address: chain.contracts.pdp.address,
    abi: chain.contracts.pdp.abi,
    functionName: 'getNextPieceId',
    args: [options.dataSetId],
  })

  const addPieces = await PDP.addPieces({
    dataSetId: options.dataSetId,
    clientDataSetId: dataSet.clientDataSetId,
    nextPieceId: nextPieceId,
    pieces: uploadResponses.map((response) => response.pieceCid),
    endpoint: provider[0].serviceURL,
    extraData: await signAddPieces(client, {
      clientDataSetId: dataSet.clientDataSetId,
      nextPieceId: nextPieceId,
      pieces: uploadResponses.map((response) => ({
        pieceCid: response.pieceCid,
        metadata: pieceMetadataObjectToEntry(response.metadata),
      })),
    }),
  })

  return addPieces
}
