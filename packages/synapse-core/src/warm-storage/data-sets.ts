import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import { type Account, type Address, type Chain, type Client, isAddressEqual, type Transport } from 'viem'
import { multicall, readContract, simulateContract, writeContract } from 'viem/actions'
import type * as Abis from '../abis/index.ts'
import { asChain, getChain } from '../chains.ts'
import { DataSetNotFoundError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece.ts'
import * as SP from '../sp.ts'
import { signCreateDataSet } from '../typed-data/sign-create-dataset.ts'
import { signCreateDataSetAndAddPieces } from '../typed-data/sign-create-dataset-add-pieces.ts'
import { capabilitiesListToObject } from '../utils/capabilities.ts'
import {
  datasetMetadataObjectToEntry,
  type MetadataObject,
  metadataArrayToObject,
  pieceMetadataObjectToEntry,
} from '../utils/metadata.ts'
import { decodePDPCapabilities } from '../utils/pdp-capabilities.ts'
import { randU256 } from '../utils/rand.ts'
import type { PDPOffering } from './providers.ts'

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
 * @throws - {@link DataSetNotFoundError} if the data set is not found.
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

  if (dataSet.pdpRailId === 0n) {
    throw new DataSetNotFoundError(options.dataSetId)
  }

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
  /** Whether the data set should use CDN. */
  cdn: boolean
  /** The address that will receive payments (service provider). */
  payee: Address
  /**
   * The address that will pay for the storage (client). If not provided, the default is the client address.
   * If client is from a session key this should be set to the actual payer address
   */
  payer?: Address
  /** The endpoint of the PDP API. */
  endpoint: string
  /** The metadata for the data set. */
  metadata?: MetadataObject
  /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
  clientDataSetId?: bigint
  /** The address of the record keeper to use for the signature. If not provided, the default is the Warm Storage contract address. */
  recordKeeper?: Address
}

/**
 * Create a data set
 *
 * @param client - The client to use to create the data set.
 * @param options - {@link CreateDataSetOptions}
 * @returns The response from the create data set on PDP API.
 */
export async function createDataSet(client: Client<Transport, Chain, Account>, options: CreateDataSetOptions) {
  const chain = getChain(client.chain.id)

  // Sign and encode the create data set message
  const extraData = await signCreateDataSet(client, {
    clientDataSetId: options.clientDataSetId ?? randU256(),
    payee: options.payee,
    payer: options.payer,
    metadata: datasetMetadataObjectToEntry(options.metadata, {
      cdn: options.cdn,
    }),
  })

  return SP.createDataSet({
    endpoint: options.endpoint,
    recordKeeper: options.recordKeeper ?? chain.contracts.storage.address,
    extraData,
  })
}

export type CreateDataSetAndAddPiecesOptions = {
  /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
  clientDataSetId?: bigint
  /** The address of the record keeper to use for the signature. If not provided, the default is the Warm Storage contract address. */
  recordKeeper?: Address
  /**
   * The address that will pay for the storage (client). If not provided, the default is the client address.
   *
   * If client is from a session key this should be set to the actual payer address
   */
  payer?: Address
  /** The endpoint of the PDP API. */
  endpoint: string
  /** The address that will receive payments (service provider). */
  payee: Address
  /** Whether the data set should use CDN. */
  cdn: boolean
  /** The metadata for the data set. */
  metadata?: MetadataObject
  /** The pieces and metadata to add to the data set. */
  pieces: { pieceCid: PieceCID; metadata?: MetadataObject }[]
}

export namespace createDataSetAndAddPieces {
  export type OptionsType = CreateDataSetAndAddPiecesOptions
  export type ReturnType = SP.createDataSetAndAddPieces.ReturnType
  export type ErrorType = SP.createDataSetAndAddPieces.ErrorType | asChain.ErrorType
}

/**
 * Create a data set and add pieces to it
 *
 * @param client - The client to use to create the data set.
 * @param options - {@link CreateDataSetAndAddPiecesOptions}
 * @returns The response from the create data set on PDP API. {@link createDataSetAndAddPieces.ReturnType}
 * @throws Errors {@link createDataSetAndAddPieces.ErrorType}
 */
export async function createDataSetAndAddPieces(
  client: Client<Transport, Chain, Account>,
  options: CreateDataSetAndAddPiecesOptions
): Promise<createDataSetAndAddPieces.ReturnType> {
  const chain = asChain(client.chain)

  return SP.createDataSetAndAddPieces({
    endpoint: options.endpoint,
    recordKeeper: options.recordKeeper ?? chain.contracts.storage.address,
    extraData: await signCreateDataSetAndAddPieces(client, {
      clientDataSetId: options.clientDataSetId ?? randU256(),
      payee: options.payee,
      payer: options.payer,
      metadata: datasetMetadataObjectToEntry(options.metadata, {
        cdn: options.cdn,
      }),
      pieces: options.pieces.map((piece) => ({
        pieceCid: piece.pieceCid,
        metadata: pieceMetadataObjectToEntry(piece.metadata),
      })),
    }),
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
