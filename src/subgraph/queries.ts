/**
 * Subgraph queries
 */

export const QUERIES = {
  // queries for subgraphRetriever
  GET_APPROVED_PROVIDERS_FOR_PIECE_LINK: `
    query GetApprovedProvidersForCommP($cid: Bytes!) {
      pieces(where: { cid: $cid }) {
        id
        dataSet {
          setId
          owner {
            id
            address
            pdpUrl
            pieceRetrievalUrl
            registeredAt
            status
            approvedAt
          }
        }
      }
    }
  `,
  GET_PROVIDER_BY_ADDRESS: `
    query Provider($providerId: ID!) {
      provider(id: $providerId) {
        id
        address
        pdpUrl
        pieceRetrievalUrl
        registeredAt
        approvedAt
      }
    }
  `,
  // flexible query templates
  GET_PROVIDERS_FLEXIBLE: `
    query ProvidersFlexible($where: Provider_filter, $first: Int, $skip: Int, $orderBy: Provider_orderBy, $orderDirection: OrderDirection) {
      providers(
        where: $where
        first: $first
        skip: $skip
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
        address
        pdpUrl
        pieceRetrievalUrl
        registeredAt
        approvedAt
        status
        totalFaultedPeriods
        totalFaultedPieces
        totalDataSets
        totalPieces
        totalDataSize
        createdAt
        updatedAt
      }
    }
  `,
  GET_DATA_SETS_FLEXIBLE: `
    query DataSetsFlexible($where: DataSet_filter, $first: Int, $skip: Int, $orderBy: DataSet_orderBy, $orderDirection: OrderDirection) {
      dataSets(
        where: $where
        first: $first
        skip: $skip
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
        setId
        listener
        clientAddr
        withCDN
        isActive
        leafCount
        challengeRange
        lastProvenEpoch
        nextChallengeEpoch
        totalPieces
        totalDataSize
        totalProofs
        totalProvedPieces
        totalFaultedPeriods
        totalFaultedPieces
        metadata
        createdAt
        updatedAt
        owner {
          id
          address
          pdpUrl
          pieceRetrievalUrl
          registeredAt
          approvedAt
        }
        rail {
          id
          railId
          token
          paymentRate
          lockupPeriod
          settledUpto
          endEpoch
        }
      }
    }
  `,
  GET_PIECES_FLEXIBLE: `
    query PiecesFlexible($where: Piece_filter, $first: Int, $skip: Int, $orderBy: Piece_orderBy, $orderDirection: OrderDirection) {
      pieces(
        where: $where
        first: $first
        skip: $skip
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
        setId
        pieceId
        rawSize
        leafCount
        cid
        removed
        totalProofsSubmitted
        totalPeriodsFaulted
        lastProvenEpoch
        lastProvenAt
        lastFaultedEpoch
        lastFaultedAt
        createdAt
        metadata
        dataSet {
          id
          setId
          isActive
          owner {
            id
            address
            pdpUrl
            pieceRetrievalUrl
            registeredAt
            approvedAt
          }
        }
      }
    }
  `,
  GET_FAULT_RECORDS_FLEXIBLE: `
    query FaultRecordsFlexible($where: FaultRecord_filter, $first: Int, $skip: Int, $orderBy: FaultRecord_orderBy, $orderDirection: OrderDirection) {
      faultRecords(
        where: $where
        first: $first
        skip: $skip
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
        dataSetId
        pieceIds
        currentChallengeEpoch
        nextChallengeEpoch
        periodsFaulted
        deadline
        createdAt
        dataSet {
          id
          setId
          owner {
            id
            address
            pdpUrl
            pieceRetrievalUrl
            registeredAt
            approvedAt
          }
        }
      }
    }
  `
} as const
