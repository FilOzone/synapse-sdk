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
          serviceProvider {
            id
            providerId
            serviceProvider
            payee
            name
            description
            registeredAt
            status
            approvedAt
            products {
              decodedProductData
              productType
              isActive
              capabilityValues
              capabilityKeys
            }
          }
        }
      }
    }
  `,
  GET_PROVIDER_BY_ADDRESS: `
    query Provider($serviceProvider: ID!) {
      provider (id: $serviceProvider) {
        id
        providerId
        serviceProvider
        payee
        name
        description
        registeredAt
        status
        approvedAt
        products {
          decodedProductData
          productType
          isActive
          capabilityValues
          capabilityKeys
        }
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
        providerId
        serviceProvider
        payee
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
        products {
          decodedProductData
          productType
          isActive
          capabilityValues
          capabilityKeys
        }
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
        payer
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
        metadataKeys
        metadataValues
        createdAt
        updatedAt
        serviceProvider {
          id
          providerId
          serviceProvider
          payee
          name
          description
          registeredAt
          status
          approvedAt
          products {
            decodedProductData
            productType
            isActive
            capabilityValues
            capabilityKeys
          }
        }
        rails {
          id
          type
          railId
          token
          paymentRate
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
        metadataKeys
        metadataValues
        dataSet {
          id
          setId
          isActive
          serviceProvider {
            id
            providerId
            serviceProvider
            payee
            name
            description
            registeredAt
            status
            approvedAt
            products {
              decodedProductData
              productType
              isActive
              capabilityValues
              capabilityKeys
            }
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
          serviceProvider {
            id
            providerId
            serviceProvider
            payee
            name
            description
            registeredAt
            status
            approvedAt
            products {
              decodedProductData
              productType
              isActive
              capabilityValues
              capabilityKeys
            }
          }
        }
      }
    }
  `,
} as const
