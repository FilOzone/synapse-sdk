import type { AbiParametersToPrimitiveTypes, ExtractAbiFunction } from 'abitype'
import { type Account, type Address, type Chain, type Client, isAddressEqual, type Transport } from 'viem'
import { multicall, readContract } from 'viem/actions'
import type * as Abis from '../abis/index.ts'
import { getChain } from '../chains.ts'
import * as PDP from '../curio.ts'
import { signCreateDataSet } from '../typed-data/sign-create-dataset.ts'
import { datasetMetadataObjectToEntry, type MetadataObject, metadataArrayToObject } from '../utils/metadata.ts'
import type { PDPProvider } from './providers.ts'

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
  pdpDatasetId: bigint
  live: boolean
  managed: boolean
  cdn: boolean
  metadata: MetadataObject
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
    const pdpDatasetId = await readContract(client, {
      address: chain.contracts.storageView.address,
      abi: chain.contracts.storageView.abi,
      functionName: 'railToDataSet',
      args: [dataSet.pdpRailId],
    })

    const [live, listener, metadata] = await multicall(client, {
      allowFailure: false,
      contracts: [
        {
          abi: chain.contracts.pdp.abi,
          address: chain.contracts.pdp.address,
          functionName: 'dataSetLive',
          args: [pdpDatasetId],
        },
        {
          abi: chain.contracts.pdp.abi,
          address: chain.contracts.pdp.address,
          functionName: 'getDataSetListener',
          args: [pdpDatasetId],
        },
        {
          address: chain.contracts.storageView.address,
          abi: chain.contracts.storageView.abi,
          functionName: 'getAllDataSetMetadata',
          args: [pdpDatasetId],
        },
      ],
    })

    return {
      ...dataSet,
      pdpDatasetId,
      live,
      managed: isAddressEqual(listener, chain.contracts.storage.address),
      cdn: dataSet.cdnRailId !== 0n,
      metadata: metadataArrayToObject(metadata),
    }
  })
  const proofs = await Promise.all(promises)

  return proofs
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
  publicClient?: Client<Transport, Chain>
  metadata?: MetadataObject
}

export async function createDataSet(client: Client<Transport, Chain, Account>, options: CreateDataSetOptions) {
  const chain = getChain(client.chain.id)
  const endpoint = options.provider.pdp.serviceURL

  // Get the next client data set id
  const nextClientDataSetId = await readContract(client, {
    address: chain.contracts.storageView.address,
    abi: chain.contracts.storageView.abi,
    functionName: 'clientDataSetIDs',
    args: [client.account.address],
  })

  // Sign and encode the create data set message
  const extraData = await signCreateDataSet(client, {
    clientDataSetId: nextClientDataSetId,
    payee: options.provider.payee,
    metadata: datasetMetadataObjectToEntry(options.metadata, {
      cdn: options.cdn,
    }),
  })

  return PDP.createDataSet({
    endpoint,
    recordKeeper: chain.contracts.storage.address,
    extraData,
  })
}
