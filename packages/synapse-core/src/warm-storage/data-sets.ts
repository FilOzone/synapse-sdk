import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  encodeAbiParameters,
  isAddressEqual,
  type Transport,
} from 'viem'
import { multicall, readContract, simulateContract, writeContract } from 'viem/actions'
import type * as Abis from '../abis/index.ts'
import { getChain } from '../chains.ts'
import type { PieceCID } from '../piece.ts'
import * as SP from '../sp.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { signCreateDataSet } from '../typed-data/sign-create-dataset.ts'
import { capabilitiesListToObject } from '../utils/capabilities.ts'
import {
  datasetMetadataObjectToEntry,
  type MetadataObject,
  metadataArrayToObject,
  pieceMetadataObjectToEntry,
} from '../utils/metadata.ts'
import { decodePDPCapabilities, type PDPOffering, type PDPProvider } from '../utils/pdp-capabilities.ts'
import { randU256 } from '../utils/rand.ts'

/**
 * ABI function to get the client data sets
 */
export type getClientDataSetsType = ExtractAbiFunction<typeof Abis.storageView, 'getClientDataSets'>

/**
 * ABI Client data set
 */
export type ClientDataSet = AbiParametersToPrimitiveTypes<getClientDataSetsType['outputs']>[0][0]

/**
 * Data set type
 */
export interface DataSet extends ClientDataSet {
  live: boolean
  managed: boolean
  cdn: boolean
  metadata: MetadataObject
  pdp: PDPOffering
}

export interface GetDataSetsOptions {
  address: Address
}

/**
 * Get all data sets for a client
 *
 * @param client
 * @param options
 */
export async function getDataSets(client: Client<Transport, Chain>, options: GetDataSetsOptions): Promise<DataSet[]> {
  const chain = getChain(client.chain.id)
  const address = options.address
  const data = await readContract(client, {
    address: chain.contracts.storageView.address,
    abi: chain.contracts.storageView.abi,
    functionName: 'getClientDataSets',
    args: [address],
  })

  const promises = data.map(async (dataSet) => {
    const [live, listener, metadata, pdpOffering] = await multicall(client, {
      allowFailure: false,
      contracts: [
        {
          abi: chain.contracts.pdp.abi,
          address: chain.contracts.pdp.address,
          functionName: 'dataSetLive',
          args: [dataSet.dataSetId],
        },
        {
          abi: chain.contracts.pdp.abi,
          address: chain.contracts.pdp.address,
          functionName: 'getDataSetListener',
          args: [dataSet.dataSetId],
        },
        {
          address: chain.contracts.storageView.address,
          abi: chain.contracts.storageView.abi,
          functionName: 'getAllDataSetMetadata',
          args: [dataSet.dataSetId],
        },
        {
          address: chain.contracts.serviceProviderRegistry.address,
          abi: chain.contracts.serviceProviderRegistry.abi,
          functionName: 'getProviderWithProduct',
          args: [dataSet.providerId, 0], // 0 = PDP product type
        },
      ],
    })

    // getProviderWithProduct returns {providerId, providerInfo, product, productCapabilityValues}
    const pdpCaps = decodePDPCapabilities(
      capabilitiesListToObject(pdpOffering.product.capabilityKeys, pdpOffering.productCapabilityValues)
    )

    return {
      ...dataSet,
      live,
      managed: isAddressEqual(listener, chain.contracts.storage.address),
      cdn: dataSet.cdnRailId !== 0n,
      metadata: metadataArrayToObject(metadata),
      pdp: pdpCaps,
    }
  })
  const proofs = await Promise.all(promises)

  return proofs
}

export type GetDataSetOptions = {
  /**
   * The ID of the data set to get.
   */
  dataSetId: bigint
}

/**
 * Get a data set by ID
 *
 * @param client - The client to use to get the data set.
 * @param options - The options for the get data set.
 * @param options.dataSetId - The ID of the data set to get.
 * @returns The data set
 */
export async function getDataSet(client: Client<Transport, Chain>, options: GetDataSetOptions): Promise<DataSet> {
  const chain = getChain(client.chain.id)

  const dataSet = await readContract(client, {
    address: chain.contracts.storageView.address,
    abi: chain.contracts.storageView.abi,
    functionName: 'getDataSet',
    args: [options.dataSetId],
  })

  const [live, listener, metadata, pdpOffering] = await multicall(client, {
    allowFailure: false,
    contracts: [
      {
        abi: chain.contracts.pdp.abi,
        address: chain.contracts.pdp.address,
        functionName: 'dataSetLive',
        args: [options.dataSetId],
      },
      {
        abi: chain.contracts.pdp.abi,
        address: chain.contracts.pdp.address,
        functionName: 'getDataSetListener',
        args: [options.dataSetId],
      },
      {
        address: chain.contracts.storageView.address,
        abi: chain.contracts.storageView.abi,
        functionName: 'getAllDataSetMetadata',
        args: [options.dataSetId],
      },
      {
        address: chain.contracts.serviceProviderRegistry.address,
        abi: chain.contracts.serviceProviderRegistry.abi,
        functionName: 'getProviderWithProduct',
        args: [dataSet.providerId, 0], // 0 = PDP product type
      },
    ],
  })

  // getProviderWithProduct returns {providerId, providerInfo, product, productCapabilityValues}
  const pdpCaps = decodePDPCapabilities(
    capabilitiesListToObject(pdpOffering.product.capabilityKeys, pdpOffering.productCapabilityValues)
  )

  return {
    ...dataSet,
    live,
    managed: isAddressEqual(listener, chain.contracts.storage.address),
    cdn: dataSet.cdnRailId !== 0n,
    metadata: metadataArrayToObject(metadata),
    pdp: pdpCaps,
  }
}

/**
 * Get the metadata for a data set
 *
 * @param client
 * @param dataSetId
 * @returns
 */
export async function getDataSetMetadata(client: Client<Transport, Chain>, dataSetId: bigint) {
  const chain = getChain(client.chain.id)
  const metadata = await readContract(client, {
    address: chain.contracts.storageView.address,
    abi: chain.contracts.storageView.abi,
    functionName: 'getAllDataSetMetadata',
    args: [dataSetId],
  })
  return metadataArrayToObject(metadata)
}

export type CreateDataSetOptions = {
  /**
   * PDP Provider
   */
  provider: PDPProvider
  cdn: boolean
  metadata?: MetadataObject
}

/**
 * Create a data set
 *
 * @param client - The client to use to create the data set.
 * @param options - The options for the create data set.
 * @param options.provider - The PDP provider to use to create the data set.
 * @param options.cdn - Whether the data set should use CDN.
 * @param options.metadata - The metadata for the data set.
 * @returns The response from the create data set on PDP API.
 */
export async function createDataSet(client: Client<Transport, Chain, Account>, options: CreateDataSetOptions) {
  const chain = getChain(client.chain.id)
  const endpoint = options.provider.pdp.serviceURL

  const nonce = randU256()

  // Sign and encode the create data set message
  const extraData = await signCreateDataSet(client, {
    clientDataSetId: nonce,
    payee: options.provider.payee,
    metadata: datasetMetadataObjectToEntry(options.metadata, {
      cdn: options.cdn,
    }),
  })

  return SP.createDataSet({
    endpoint,
    recordKeeper: chain.contracts.storage.address,
    extraData,
  })
}

export type CreateDataSetAndAddPiecesOptions = {
  /**
   * PDP Provider
   */
  provider: PDPProvider
  cdn: boolean
  metadata?: MetadataObject
  pieces: { pieceCid: PieceCID; metadata?: MetadataObject }[]
}

/**
 * Create a data set and add pieces to it
 *
 * @param client - The client to use to create the data set.
 * @param options - The options for the create data set.
 * @param options.provider - The PDP provider to use to create the data set.
 * @param options.cdn - Whether the data set should use CDN.
 * @param options.metadata - The metadata for the data set.
 * @returns The response from the create data set on PDP API.
 */
export async function createDataSetAndAddPieces(
  client: Client<Transport, Chain, Account>,
  options: CreateDataSetAndAddPiecesOptions
) {
  const chain = getChain(client.chain.id)
  const endpoint = options.provider.pdp.serviceURL
  const clientDataSetId = randU256()
  // Sign and encode the create data set message
  const dataSetExtraData = await signCreateDataSet(client, {
    clientDataSetId,
    payee: options.provider.payee,
    metadata: datasetMetadataObjectToEntry(options.metadata, {
      cdn: options.cdn,
    }),
  })

  // Sign and encode the add pieces message
  const addPiecesExtraData = await signAddPieces(client, {
    clientDataSetId,
    nonce: randU256(),
    pieces: options.pieces.map((piece) => ({
      pieceCid: piece.pieceCid,
      metadata: pieceMetadataObjectToEntry(piece.metadata),
    })),
  })

  const extraData = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes' }], [dataSetExtraData, addPiecesExtraData])

  return SP.createDataSetAndAddPieces({
    endpoint,
    recordKeeper: chain.contracts.storage.address,
    extraData,
    pieces: options.pieces.map((piece) => piece.pieceCid),
  })
}

export type TerminateDataSetOptions = {
  /**
   * The ID of the data set to terminate.
   */
  dataSetId: bigint
}

export async function terminateDataSet(client: Client<Transport, Chain, Account>, options: TerminateDataSetOptions) {
  const chain = getChain(client.chain.id)

  const { request } = await simulateContract(client, {
    address: chain.contracts.storage.address,
    abi: chain.contracts.storage.abi,
    functionName: 'terminateService',
    args: [options.dataSetId],
  })

  const tx = await writeContract(client, request)
  return tx
}
