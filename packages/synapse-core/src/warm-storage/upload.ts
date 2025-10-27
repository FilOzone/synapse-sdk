import type { Account, Chain, Client, Transport } from 'viem'
import { hexToString } from 'viem'
import { readContract } from 'viem/actions'
import { getChain } from '../chains.ts'
import { randU256 } from '../rand.ts'
import * as PDP from '../sp.ts'
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

  const providerWithProduct = await readContract(client, {
    address: chain.contracts.serviceProviderRegistry.address,
    abi: chain.contracts.serviceProviderRegistry.abi,
    functionName: 'getProviderWithProduct',
    args: [dataSet.providerId, 0], // productType PDP = 0
  })

  // Decode capabilities to get service URL
  const capabilities = providerWithProduct.product.capabilityKeys.reduce(
    (acc, key, i) => {
      acc[key] = providerWithProduct.productCapabilityValues[i]
      return acc
    },
    {} as Record<string, `0x${string}`>
  )
  const serviceURL = capabilities.serviceURL ? hexToString(capabilities.serviceURL) : ''

  const uploadResponses = await Promise.all(
    options.data.map(async (data) => {
      const upload = await PDP.uploadPiece({
        data: new Uint8Array(await data.arrayBuffer()),
        endpoint: serviceURL,
      })

      await PDP.findPiece({
        pieceCid: upload.pieceCid,
        endpoint: serviceURL,
      })

      return {
        pieceCid: upload.pieceCid,
        metadata: { name: data.name, type: data.type },
      }
    })
  )

  const nonce = randU256()

  const addPieces = await PDP.addPieces({
    dataSetId: options.dataSetId,
    pieces: uploadResponses.map((response) => response.pieceCid),
    endpoint: serviceURL,
    extraData: await signAddPieces(client, {
      clientDataSetId: dataSet.clientDataSetId,
      nonce,
      pieces: uploadResponses.map((response) => ({
        pieceCid: response.pieceCid,
        metadata: pieceMetadataObjectToEntry(response.metadata),
      })),
    }),
  })

  return addPieces
}
