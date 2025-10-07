import { CONTRACT_ADDRESSES } from '../../utils/constants.ts'

// DataSetCreated(uint256,uint256)
const DATA_SET_CREATED_TOPIC0 = '0x11369440e1b7135015c16acb9bc14b55b0f4b23b02010c363d34aec2e5b96281'

// DataSetCreated(uint256,uint256,uint256,uint256,uint256,address,address,address,string[],string[])
// TODO(update-abi) const DATA_SET_CREATED_TOPIC0 = '0xc90cb3863281dc6e2e16e74064ed2e0ab91144ccfe5c3492b8c33f58fe90d0db'

function pad64(a: number): string {
  const hex = BigInt(a).toString(16)
  return '0'.repeat(64 - hex.length) + hex
}

export function makeDataSetCreatedLog(dataSetId: number, providerId: number): any {
  return {
    address: CONTRACT_ADDRESSES.WARM_STORAGE.calibration,
    blockHash: '0xb91b7314248aaae06f080ad427dbae78b8c5daf72b2446cf843739aef80c6417',
    blockNumber: '0x127001',
    transactionHash: '0x3816d82cb7a6f5cde23f4d63c0763050d13c6b6dc659d0a7e6eba80b0ec76a18',
    transactionIndex: '0x10',
    logIndex: '0x17',
    topics: [DATA_SET_CREATED_TOPIC0, `0x${pad64(dataSetId)}`, `0x${pad64(providerId)}`],
    data: [
      '0x',
      /*
      pad64(0), // pdpRailId
        pad64(0), // cacheMissRailId,
        pad64(0), // cdnRailId,
        pad64(0), // payer,
        pad64(0), // serviceProvider,
        pad64(0), // payee,
        pad64(0), // metadataKeys,
        pad64(0), // metadataValues
    */
    ].join(''),
  }
}
